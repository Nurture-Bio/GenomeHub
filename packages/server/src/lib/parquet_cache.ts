/**
 * Ephemeral Parquet cache — stream-while-caching architecture.
 *
 * First query hits S3 directly (DuckDB streams natively) while the file
 * downloads to local disk in the background.  Subsequent queries read
 * from NVMe-speed local I/O.
 *
 * - Non-blocking: never makes the caller wait for a download.
 * - Mutex: concurrent background downloads share one promise per key.
 * - Janitor: reaps files untouched for >1 hour (runs every 10 minutes).
 * - Local mode: no-op passthrough (files are already on disk).
 *
 * @module
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isLocal, storagePath, duckdbSrc } from './storage.js';
import { s3, BUCKET } from './s3.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const CACHE_DIR = '/tmp/parquet-cache';
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const REAP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** In-flight downloads — concurrent callers share one promise per key. */
const inflight = new Map<string, Promise<string>>();

/** Ensure cache directory exists (once). */
let dirReady = false;
async function ensureCacheDir(): Promise<void> {
  if (dirReady) return;
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  dirReady = true;
}

/** Stable local filename from S3 key. */
function cachePath(s3Key: string): string {
  const safe = s3Key.replace(/[^a-zA-Z0-9._\-]/g, '_');
  return path.join(CACHE_DIR, safe);
}

/**
 * Resolve a Parquet S3 key to a DuckDB-readable path.
 *
 * - If the file is already cached on local disk, returns the local path.
 * - If the file is NOT cached, kicks off a background download and
 *   immediately returns the `s3://` URI so DuckDB can stream natively.
 * - The caller never blocks on a download.
 *
 * In local mode, returns the storage path directly (no download).
 */
export async function resolveLocalParquet(s3Key: string): Promise<string> {
  // Local dev — files are already on disk
  if (isLocal) return storagePath(s3Key);

  const local = cachePath(s3Key);

  // Fast path: already cached on disk
  try {
    await fsp.access(local, fs.constants.R_OK);
    // Touch access time so the janitor knows it's hot
    const now = new Date();
    await fsp.utimes(local, now, now).catch(() => {});
    return local;
  } catch {
    // Not cached — fall through to background warmup
  }

  // Background warmup: start download if not already in flight.
  // Do NOT await — the caller gets the S3 path immediately.
  if (!inflight.has(s3Key)) {
    const promise = download(s3Key, local);
    inflight.set(s3Key, promise);
    promise
      .catch((err) => {
        console.error(JSON.stringify({
          tag: '[PARQUET_CACHE]',
          action: 'download_failed',
          s3Key,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }));
      })
      .finally(() => {
        inflight.delete(s3Key);
      });
  }

  // Return the S3 URI — DuckDB streams natively while the cache warms
  return duckdbSrc(s3Key);
}

/** Stream S3 object to local disk. */
async function download(s3Key: string, dest: string): Promise<string> {
  await ensureCacheDir();

  const tmp = dest + '.tmp';
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  if (!res.Body) throw new Error(`S3 returned empty body for ${s3Key}`);

  const writeStream = fs.createWriteStream(tmp);
  await pipeline(res.Body as NodeJS.ReadableStream, writeStream);

  // Atomic rename — readers never see a partial file
  await fsp.rename(tmp, dest);

  const stat = await fsp.stat(dest);
  console.log(JSON.stringify({
    tag: '[PARQUET_CACHE]',
    action: 'downloaded',
    s3Key,
    sizeBytes: stat.size,
    cachePath: dest,
    timestamp: new Date().toISOString(),
  }));

  return dest;
}

/** Reap files older than MAX_AGE_MS. */
async function reap(): Promise<void> {
  try {
    const entries = await fsp.readdir(CACHE_DIR);
    const now = Date.now();
    for (const entry of entries) {
      if (entry.endsWith('.tmp')) continue; // in-flight download
      const fp = path.join(CACHE_DIR, entry);
      try {
        const stat = await fsp.stat(fp);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          await fsp.rm(fp, { force: true });
          console.log(JSON.stringify({
            tag: '[PARQUET_CACHE]',
            action: 'reaped',
            file: entry,
            ageMs: Math.round(now - stat.mtimeMs),
            timestamp: new Date().toISOString(),
          }));
        }
      } catch { /* file may have been deleted concurrently */ }
    }
  } catch { /* cache dir may not exist yet */ }
}

// Start the janitor (only in S3 mode)
if (!isLocal) {
  setInterval(reap, REAP_INTERVAL_MS).unref();
}

/**
 * Storage abstraction — local filesystem when S3_BUCKET is unset.
 *
 * When `S3_BUCKET` is set, the app uses S3 for all file storage.
 * When unset (local dev), files live under `data/storage/` on disk.
 *
 * @module
 */

import path from 'node:path';
import fs from 'node:fs/promises';

export const isLocal = !process.env.S3_BUCKET;

const LOCAL_ROOT = path.resolve(process.env.LOCAL_STORAGE_PATH ?? 'data/storage');

/** Absolute local path for a storage key. Rejects traversal. */
export function storagePath(key: string): string {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (!resolved.startsWith(LOCAL_ROOT + path.sep) && resolved !== LOCAL_ROOT)
    throw new Error('storage: path traversal rejected');
  return resolved;
}

/** Local root directory (for express.static). */
export function localRoot(): string {
  return LOCAL_ROOT;
}

/** DuckDB source URI — S3 path or local filesystem path. */
export function duckdbSrc(key: string): string {
  if (isLocal) return storagePath(key);
  return `s3://${process.env.S3_BUCKET}/${key}`;
}

/** DuckDB initialization SQL — httpfs/aws only for S3 mode. */
export function duckdbSetup(): string {
  if (isLocal) return '';
  return 'INSTALL httpfs; LOAD httpfs; INSTALL aws; LOAD aws; CALL load_aws_credentials();';
}

/** Ensure directory exists for a storage key. */
export async function ensureDir(key: string): Promise<void> {
  await fs.mkdir(path.dirname(storagePath(key)), { recursive: true });
}

/** Read first N bytes from a local file. */
export async function readLocalHead(key: string, bytes: number): Promise<Buffer> {
  const fh = await fs.open(storagePath(key), 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Read byte range from a local file. */
export async function readLocalRange(key: string, start: number, bytes: number): Promise<Buffer> {
  const fh = await fs.open(storagePath(key), 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Get file size (local equivalent of headObject). */
export async function localFileSize(key: string): Promise<number> {
  const stat = await fs.stat(storagePath(key));
  return stat.size;
}

/** Delete a local file (ignores ENOENT). */
export async function deleteLocal(key: string): Promise<void> {
  await fs.rm(storagePath(key), { force: true });
}

/** Write chunks from temp parts into assembled file. */
export async function assembleChunks(
  fileId: string,
  s3Key: string,
  partCount: number,
): Promise<number> {
  const dest = storagePath(s3Key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmpDir = path.join(LOCAL_ROOT, 'tmp', fileId);
  const fh = await fs.open(dest, 'w');
  try {
    for (let i = 1; i <= partCount; i++) {
      const chunk = await fs.readFile(path.join(tmpDir, `part-${i}`));
      await fh.write(chunk);
    }
  } finally {
    await fh.close();
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
  const stat = await fs.stat(dest);
  return stat.size;
}

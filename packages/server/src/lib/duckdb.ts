/**
 * Shared DuckDB singleton — one :memory: instance for the process lifetime.
 *
 * Uses @duckdb/node-api (modern N-API bindings). httpfs/aws setup, the
 * community arrow extension, and duckhts (htslib BAM/VCF/CRAM reader) are
 * loaded once on first access. Connections are cheap — callers create
 * per-request and close after use.
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { duckdbSetup } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the duckhts extension binary. */
function duckhtsPath(): string {
  // __dirname = dist/lib/ or src/lib/ — extension at packages/server/extensions/
  const candidates = [
    path.resolve(__dirname, '../../extensions/duckhts.duckdb_extension'),
    path.resolve(__dirname, '../extensions/duckhts.duckdb_extension'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`duckhts extension not found (searched: ${candidates.join(', ')})`);
}

let _instance: DuckDBInstance | null = null;

/** Lazily initialize the singleton DuckDB instance. */
async function getInstance(): Promise<DuckDBInstance> {
  if (_instance) return _instance;

  const { DuckDBInstance } = await import('@duckdb/node-api');
  _instance = await DuckDBInstance.create(':memory:', {
    allow_unsigned_extensions: 'true',
  });

  const conn = await _instance.connect();
  try {
    // httpfs + aws for S3 access (no-op in local mode — duckdbSetup() returns '')
    const setup = duckdbSetup();
    if (setup) await conn.run(setup);

    // Community arrow extension for to_arrow_ipc()
    await conn.run('INSTALL arrow FROM community');
    await conn.run('LOAD arrow');

    // duckhts — htslib-based reader for BAM/SAM/CRAM/VCF/BCF
    const extPath = duckhtsPath().replace(/'/g, "''");
    await conn.run(`LOAD '${extPath}'`);
  } finally {
    conn.closeSync();
  }

  return _instance;
}

/** Get a connection from the singleton. Caller must call conn.closeSync() when done. */
export async function getConnection(): Promise<DuckDBConnection> {
  const instance = await getInstance();
  return instance.connect();
}

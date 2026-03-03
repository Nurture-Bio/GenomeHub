/**
 * Shared DuckDB singleton — one :memory: instance for the process lifetime.
 *
 * Uses @duckdb/node-api (modern N-API bindings). httpfs/aws setup and the
 * community arrow extension are loaded once on first access. Connections are
 * cheap — callers create per-request and close after use.
 *
 * @module
 */

import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { duckdbSetup } from './storage.js';

let _instance: DuckDBInstance | null = null;

/** Lazily initialize the singleton DuckDB instance. */
async function getInstance(): Promise<DuckDBInstance> {
  if (_instance) return _instance;

  const { DuckDBInstance } = await import('@duckdb/node-api');
  _instance = await DuckDBInstance.create(':memory:');

  const conn = await _instance.connect();
  try {
    // httpfs + aws for S3 access (no-op in local mode — duckdbSetup() returns '')
    const setup = duckdbSetup();
    if (setup) await conn.run(setup);

    // Community arrow extension for to_arrow_ipc()
    await conn.run('INSTALL arrow FROM community');
    await conn.run('LOAD arrow');
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

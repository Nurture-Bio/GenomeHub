/**
 * Shared DuckDB WASM singleton.
 *
 * Both useJsonDuckDb (legacy) and useParquetPreview share this single
 * engine instance — only one WASM worker is ever spawned.
 *
 * @module
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm_mvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdb_worker_mvp from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdb_worker_eh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

// Re-export for convenience
export { duckdb };

// ── Module-level singleton ────────────────────────────────

let _db:          duckdb.AsyncDuckDB | null = null;
let _conn:        duckdb.AsyncDuckDBConnection | null = null;
let _bootPromise: Promise<void> | null = null;

export async function ensureDb(): Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection }> {
  if (_db && _conn) return { db: _db, conn: _conn };
  if (_bootPromise) { await _bootPromise; return { db: _db!, conn: _conn! }; }

  _bootPromise = (async () => {
    try {
      // In Vite dev, the EH bundle needs SharedArrayBuffer but the dev server's
      // /@fs/ worker sub-requests don't inherit COOP/COEP headers — the worker
      // crashes with an undefined error and instantiate() hangs without rejecting.
      // Force MVP in dev; selectBundle picks EH in production where headers are set.
      const bundle = import.meta.env.DEV
        ? { mainModule: duckdb_wasm_mvp, mainWorker: duckdb_worker_mvp, pthreadWorker: null }
        : await duckdb.selectBundle({
            mvp: { mainModule: duckdb_wasm_mvp, mainWorker: duckdb_worker_mvp },
            eh:  { mainModule: duckdb_wasm_eh,  mainWorker: duckdb_worker_eh  },
          });
      const worker = new Worker(bundle.mainWorker!);
      _db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await _db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? undefined);
      _conn = await _db.connect();
    } catch (e) {
      _bootPromise = null;
      _db = null;
      _conn = null;
      throw e;
    }
  })();

  await _bootPromise;
  return { db: _db!, conn: _conn! };
}

// ── BigInt coercion (avoids JSON round-trip) ─────────────

export function coerceBigInts(obj: unknown): unknown {
  if (typeof obj === 'bigint') return Number(obj);
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(coerceBigInts);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      result[key] = coerceBigInts((obj as Record<string, unknown>)[key]);
    }
    return result;
  }
  return obj;
}

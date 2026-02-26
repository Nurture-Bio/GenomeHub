import { useEffect, useState, useCallback } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm_mvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdb_worker_mvp from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdb_worker_eh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface QueryResult {
  rows:          Record<string, unknown>[];
  filteredCount: number;
  error?:        string;
}

export type DuckDbStatus = 'idle' | 'loading' | 'ready' | 'error';

// ── Module-level singleton ────────────────────────────────
// DuckDB instance and loaded table persist across component mounts.
// Re-fetch only when the file ID changes.

let _db:           duckdb.AsyncDuckDB | null = null;
let _conn:         duckdb.AsyncDuckDBConnection | null = null;
let _loadedFileId: string | null = null;
let _bootPromise:  Promise<void> | null = null;

async function ensureDb(): Promise<void> {
  if (_db && _conn) return;
  if (_bootPromise) { await _bootPromise; return; }

  _bootPromise = (async () => {
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: duckdb_wasm_mvp, mainWorker: duckdb_worker_mvp },
      eh:  { mainModule: duckdb_wasm_eh,  mainWorker: duckdb_worker_eh  },
    });
    const worker  = new Worker(bundle.mainWorker!);
    _db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    _conn = await _db.connect();
  })();

  await _bootPromise;
}

// ── Hook ─────────────────────────────────────────────────

export function useJsonDuckDb(
  fileId:  string | null,
  getUrl:  (() => Promise<string>) | null,
) {
  const [status,    setStatus]    = useState<DuckDbStatus>('idle');
  const [columns,   setColumns]   = useState<ColumnInfo[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || !getUrl) return;
    const fn = getUrl; // capture before async context — TypeScript narrowing holds here
    let cancelled = false;

    async function load() {
      setStatus('loading');
      try {
        await ensureDb();
        if (cancelled) return;

        if (_loadedFileId !== fileId) {
          // Drop stale table and load fresh data via DuckDB's HTTP bridge
          await _conn!.query(`DROP TABLE IF EXISTS result`);
          const url = await fn();
          if (cancelled) return;

          await _conn!.query(`
            CREATE TABLE result AS
            SELECT * FROM read_json_auto('${url}', maximum_object_size=104857600)
          `);
          _loadedFileId = fileId;
        }

        const desc  = await _conn!.query(`DESCRIBE result`);
        const count = await _conn!.query(`SELECT COUNT(*)::INTEGER AS n FROM result`);

        const cols: ColumnInfo[] = desc.toArray().map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return { name: String(row.column_name), type: String(row.column_type) };
        });
        const total = Number((count.toArray()[0] as Record<string, unknown>).n);

        if (!cancelled) {
          setColumns(cols);
          setTotalRows(total);
          setStatus('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStatus('error');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [fileId, getUrl]);

  const query = useCallback(async (fragments: Record<string, string>): Promise<QueryResult | null> => {
    if (!_conn) return null;

    const conditions = Object.values(fragments).filter(v => v.trim());
    const where = conditions.length ? `WHERE ${conditions.map(c => `(${c})`).join(' AND ')}` : '';

    try {
      const rows = await _conn.query(`SELECT * FROM result ${where} LIMIT 1000`);
      const cnt  = await _conn.query(`SELECT COUNT(*)::INTEGER AS n FROM result ${where}`);
      const bigIntReplacer = (_: string, v: unknown) => typeof v === 'bigint' ? Number(v) : v;
      return {
        rows:          rows.toArray().map((r: unknown) => JSON.parse(JSON.stringify(r, bigIntReplacer))),
        filteredCount: Number((cnt.toArray()[0] as Record<string, unknown>).n),
      };
    } catch (e) {
      return { rows: [], filteredCount: 0, error: String(e) };
    }
  }, []);

  return { status, columns, totalRows, error, query };
}

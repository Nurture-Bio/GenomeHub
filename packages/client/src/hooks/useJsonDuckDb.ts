import { useEffect, useRef, useState, useCallback } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface QueryResult {
  rows:          Record<string, unknown>[];
  filteredCount: number;
  error?:        string;
}

export type DuckDbStatus = 'idle' | 'fetching' | 'loading' | 'ready' | 'error';

export function useJsonDuckDb(fileUrl: string | null) {
  const [status,    setStatus]    = useState<DuckDbStatus>('idle');
  const [columns,   setColumns]   = useState<ColumnInfo[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [error,     setError]     = useState<string | null>(null);

  const dbRef   = useRef<duckdb.AsyncDuckDB | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);

  useEffect(() => {
    if (!fileUrl) return;

    let cancelled = false;

    async function init() {
      try {
        // 1. Fetch the file
        setStatus('fetching');
        const response = await fetch(fileUrl!);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (cancelled) return;

        // 2. Boot DuckDB
        setStatus('loading');
        const bundles = duckdb.getJsDelivrBundles();
        const bundle  = await duckdb.selectBundle(bundles);
        const worker  = new Worker(bundle.mainWorker!);
        const db      = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        if (cancelled) { db.terminate(); return; }

        dbRef.current  = db;
        const conn     = await db.connect();
        connRef.current = conn;

        // 3. Register file + create table
        await db.registerFileText('data.json', text);
        await conn.query(`CREATE TABLE result AS SELECT * FROM read_json_auto('data.json')`);

        // 4. Describe schema + row count
        const desc  = await conn.query(`DESCRIBE result`);
        const count = await conn.query(`SELECT COUNT(*)::INTEGER AS n FROM result`);

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

    init();

    return () => {
      cancelled = true;
      connRef.current?.close().catch(() => void 0);
      dbRef.current?.terminate();
      dbRef.current  = null;
      connRef.current = null;
    };
  }, [fileUrl]);

  const query = useCallback(async (fragments: Record<string, string>): Promise<QueryResult | null> => {
    const conn = connRef.current;
    if (!conn) return null;

    const conditions = Object.values(fragments).filter(v => v.trim());
    const where = conditions.length ? `WHERE ${conditions.map(c => `(${c})`).join(' AND ')}` : '';

    try {
      const rows = await conn.query(`SELECT * FROM result ${where} LIMIT 1000`);
      const cnt  = await conn.query(`SELECT COUNT(*)::INTEGER AS n FROM result ${where}`);
      return {
        rows:          rows.toArray().map((r: unknown) => JSON.parse(JSON.stringify(r))),
        filteredCount: Number((cnt.toArray()[0] as Record<string, unknown>).n),
      };
    } catch (e) {
      return { rows: [], filteredCount: 0, error: String(e) };
    }
  }, []);

  return { status, columns, totalRows, error, query };
}

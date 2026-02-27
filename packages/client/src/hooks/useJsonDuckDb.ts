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

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

export interface ColumnStats {
  min: number;
  max: number;
}

export interface ColumnCardinality {
  distinct: number;
  values:   string[];   // sorted; empty if distinct > DROPDOWN_MAX
}

/** Columns with ≤ FACET_MAX distinct values are pulled into a facet bar */
export const FACET_MAX = 5;
/** Columns with ≤ DROPDOWN_MAX distinct values get a dropdown selector */
export const DROPDOWN_MAX = 50;

export interface QueryParams {
  filters: Record<string, string>;
  sort?:   SortSpec | null;
}

export interface QueryResult {
  rows:          Record<string, unknown>[];
  filteredCount: number;
  error?:        string;
}

export type DuckDbStatus = 'idle' | 'loading' | 'ready' | 'error';

// ── Numeric type detection ────────────────────────────────

const NUMERIC_TYPES = new Set([
  'TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'HUGEINT',
  'UTINYINT', 'USMALLINT', 'UINTEGER', 'UBIGINT',
  'FLOAT', 'DOUBLE', 'DECIMAL',
]);

export function isNumericType(type: string): boolean {
  const base = type.replace(/\(.+\)/, '').trim().toUpperCase();
  return NUMERIC_TYPES.has(base);
}

// ── Module-level singleton ────────────────────────────────

let _db:           duckdb.AsyncDuckDB | null = null;
let _conn:         duckdb.AsyncDuckDBConnection | null = null;
let _loadedFileId: string | null = null;
let _bootPromise:  Promise<void> | null = null;
let _loadPromise:  Promise<void> | null = null;

async function ensureDb(): Promise<void> {
  if (_db && _conn) return;
  if (_bootPromise) { await _bootPromise; return; }

  _bootPromise = (async () => {
    try {
      const bundle = await duckdb.selectBundle({
        mvp: { mainModule: duckdb_wasm_mvp, mainWorker: duckdb_worker_mvp },
        eh:  { mainModule: duckdb_wasm_eh,  mainWorker: duckdb_worker_eh  },
      });
      const worker = new Worker(bundle.mainWorker!);
      _db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await _db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      _conn = await _db.connect();
    } catch (e) {
      _bootPromise = null;
      _db = null;
      _conn = null;
      throw e;
    }
  })();

  await _bootPromise;
}

async function ensureTable(fileId: string, getUrl: () => Promise<string>): Promise<void> {
  if (_loadedFileId === fileId) return;
  if (_loadPromise) { await _loadPromise; return; }

  _loadPromise = (async () => {
    try {
      await _conn!.query(`DROP TABLE IF EXISTS result`);
      const url = await getUrl();
      await _db!.registerFileURL(
        'result_data.json',
        url,
        duckdb.DuckDBDataProtocol.HTTP,
        true,
      );
      await _conn!.query(`
        CREATE TABLE result AS
        SELECT * FROM read_json_auto('result_data.json', maximum_object_size=104857600)
      `);
      _loadedFileId = fileId;
    } finally {
      _loadPromise = null;
    }
  })();

  await _loadPromise;
}

// ── Hook ─────────────────────────────────────────────────

export function useJsonDuckDb(
  fileId: string | null,
  getUrl: (() => Promise<string>) | null,
) {
  const [status,            setStatus]            = useState<DuckDbStatus>('idle');
  const [columns,           setColumns]           = useState<ColumnInfo[]>([]);
  const [totalRows,         setTotalRows]         = useState(0);
  const [columnStats,       setColumnStats]       = useState<Record<string, ColumnStats>>({});
  const [columnCardinality, setColumnCardinality] = useState<Record<string, ColumnCardinality>>({});
  const [error,             setError]             = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || !getUrl) return;
    const id = fileId;
    const fn = getUrl;
    let cancelled = false;

    async function load() {
      setStatus('loading');
      try {
        await ensureDb();
        if (cancelled) return;

        await ensureTable(id, fn);
        if (cancelled) return;

        const [desc, count] = await Promise.all([
          _conn!.query(`DESCRIBE result`),
          _conn!.query(`SELECT COUNT(*)::INTEGER AS n FROM result`),
        ]);

        const cols: ColumnInfo[] = desc.toArray().map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return { name: String(row.column_name), type: String(row.column_type) };
        });
        const total = Number((count.toArray()[0] as Record<string, unknown>).n);

        // Compute min/max for numeric columns
        const numericCols = cols.filter(c => isNumericType(c.type));
        const stats: Record<string, ColumnStats> = {};

        if (numericCols.length > 0) {
          const selectParts = numericCols.flatMap(c => [
            `MIN("${c.name}")::DOUBLE AS "${c.name}_min"`,
            `MAX("${c.name}")::DOUBLE AS "${c.name}_max"`,
          ]);
          const statsResult = await _conn!.query(
            `SELECT ${selectParts.join(', ')} FROM result`
          );
          const statsRow = statsResult.toArray()[0] as Record<string, unknown>;
          for (const c of numericCols) {
            const min = Number(statsRow[`${c.name}_min`]);
            const max = Number(statsRow[`${c.name}_max`]);
            if (!isNaN(min) && !isNaN(max)) {
              stats[c.name] = { min, max };
            }
          }
        }

        // Compute cardinality for non-numeric columns (including STRUCT sub-fields)
        const cardinality: Record<string, ColumnCardinality> = {};
        const cardTargets: { path: string; sqlExpr: string }[] = [];

        for (const c of cols) {
          if (c.type.startsWith('STRUCT(')) {
            // Parse sub-fields from STRUCT type
            const inner = c.type.match(/^STRUCT\((.+)\)$/s)?.[1];
            if (!inner) continue;
            const parts: string[] = [];
            let depth = 0, start = 0;
            for (let i = 0; i < inner.length; i++) {
              if (inner[i] === '(') depth++;
              else if (inner[i] === ')') depth--;
              else if (inner[i] === ',' && depth === 0) { parts.push(inner.slice(start, i).trim()); start = i + 1; }
            }
            parts.push(inner.slice(start).trim());
            for (const part of parts) {
              const m = part.match(/^"?(\w+)"?\s+(.+)$/);
              if (m && !isNumericType(m[2])) {
                cardTargets.push({ path: `${c.name}.${m[1]}`, sqlExpr: `"${c.name}".${m[1]}` });
              }
            }
          } else if (!isNumericType(c.type)) {
            cardTargets.push({ path: c.name, sqlExpr: `"${c.name}"` });
          }
        }

        // Run one COUNT(DISTINCT) query for all targets
        if (cardTargets.length > 0) {
          const selectParts = cardTargets.map(
            (t, i) => `COUNT(DISTINCT ${t.sqlExpr}::VARCHAR)::INTEGER AS c${i}`
          );
          const cardResult = await _conn!.query(`SELECT ${selectParts.join(', ')} FROM result`);
          const cardRow = cardResult.toArray()[0] as Record<string, unknown>;

          // For low-cardinality columns, fetch actual distinct values
          const lowCardTargets = cardTargets.filter((_, i) => {
            const n = Number(cardRow[`c${i}`]);
            return n >= 1 && n <= DROPDOWN_MAX;
          });

          const valueResults: Record<string, string[]> = {};
          // Batch value fetches in parallel
          await Promise.all(lowCardTargets.map(async (t) => {
            const vResult = await _conn!.query(
              `SELECT DISTINCT ${t.sqlExpr}::VARCHAR AS v FROM result ORDER BY v`
            );
            valueResults[t.path] = vResult.toArray().map(
              (r: unknown) => String((r as Record<string, unknown>).v ?? '')
            );
          }));

          for (let i = 0; i < cardTargets.length; i++) {
            const t = cardTargets[i];
            const n = Number(cardRow[`c${i}`]);
            cardinality[t.path] = {
              distinct: n,
              values: valueResults[t.path] ?? [],
            };
          }
        }

        if (!cancelled) {
          setColumns(cols);
          setTotalRows(total);
          setColumnStats(stats);
          setColumnCardinality(cardinality);
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

  const query = useCallback(async (params: QueryParams): Promise<QueryResult | null> => {
    if (!_conn) return null;

    const conditions = Object.entries(params.filters)
      .filter(([, v]) => v.trim())
      .map(([path, expr]) => `(${path} ${expr})`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = params.sort
      ? `ORDER BY "${params.sort.column}" ${params.sort.direction.toUpperCase()}`
      : '';

    try {
      const [rows, cnt] = await Promise.all([
        _conn.query(`SELECT * FROM result ${where} ${orderBy} LIMIT 1000`),
        _conn.query(`SELECT COUNT(*)::INTEGER AS n FROM result ${where}`),
      ]);
      const bigIntReplacer = (_: string, v: unknown) => typeof v === 'bigint' ? Number(v) : v;
      return {
        rows:          rows.toArray().map((r: unknown) => JSON.parse(JSON.stringify(r, bigIntReplacer))),
        filteredCount: Number((cnt.toArray()[0] as Record<string, unknown>).n),
      };
    } catch (e) {
      return { rows: [], filteredCount: 0, error: String(e) };
    }
  }, []);

  return { status, columns, totalRows, columnStats, columnCardinality, error, query };
}

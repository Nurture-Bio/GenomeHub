/**
 * useParquetPreview — DuckDB WASM over Parquet via HTTP range requests.
 *
 * Only the Parquet footer (a few KB) is fetched on init to get the schema,
 * total row count, and per-column min/max stats. Row data is fetched
 * on-demand as the user scrolls, in LIMIT/OFFSET windows.
 *
 * @module
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { duckdb, ensureDb, coerceBigInts } from '../lib/duckdb.js';
import { apiFetch } from '../lib/api.js';

// ── Types ────────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface ColumnStats {
  min: number;
  max: number;
}

export interface ColumnCardinality {
  distinct: number;
  values: string[];
}

export type ParquetStatus =
  | 'polling'       // waiting for server to finish Parquet conversion
  | 'initializing'  // booting DuckDB WASM
  | 'loading'       // registering Parquet file + reading metadata
  | 'ready'         // schema + stats available, rows fetchable
  | 'unavailable'   // server says no Parquet (too large, not JSON, etc.)
  | 'failed'        // server conversion failed after retries
  | 'error';

/** Discriminated union — no SQL strings cross this boundary. */
export type FilterOp =
  | { type: 'between'; low: number; high: number }
  | { type: 'in';      values: string[] }
  | { type: 'ilike';   pattern: string };

export interface FilterSpec {
  column: string;
  op: FilterOp;
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

// ── Parameterized query compiler ─────────────────────────

const PARQUET_SRC = `read_parquet('preview.parquet')`;

interface CompiledQuery {
  sql:    string;
  params: unknown[];
}

/**
 * Compile typed filters into a parameterized WHERE clause.
 * Column references (from the Parquet schema) are quoted identifiers.
 * User values are $1, $2, ... parameters — never interpolated into SQL.
 */
function compileWhere(filters: FilterSpec[], startIdx = 1): { clause: string; params: unknown[]; nextIdx: number } {
  if (filters.length === 0) return { clause: '', params: [], nextIdx: startIdx };

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = startIdx;

  for (const f of filters) {
    const col = colToSql(f.column);
    switch (f.op.type) {
      case 'between':
        conditions.push(`${col} BETWEEN $${idx} AND $${idx + 1}`);
        params.push(f.op.low, f.op.high);
        idx += 2;
        break;
      case 'in': {
        const placeholders = f.op.values.map((_, i) => `$${idx + i}`).join(', ');
        conditions.push(`${col}::VARCHAR IN (${placeholders})`);
        params.push(...f.op.values);
        idx += f.op.values.length;
        break;
      }
      case 'ilike':
        conditions.push(`${col}::VARCHAR ILIKE $${idx}`);
        params.push(`%${f.op.pattern}%`);
        idx += 1;
        break;
    }
  }

  return { clause: `WHERE ${conditions.join(' AND ')}`, params, nextIdx: idx };
}

/** Execute a parameterized query via conn.prepare(). */
async function execQuery(conn: duckdb.AsyncDuckDBConnection, { sql, params }: CompiledQuery) {
  if (params.length === 0) return conn.query(sql);
  const stmt = await conn.prepare(sql);
  try { return await stmt.query(...params); }
  finally { await stmt.close(); }
}

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

/** Columns with ≤ DROPDOWN_MAX distinct values get a dropdown selector */
export const DROPDOWN_MAX = 50;

// ── STRUCT expansion ──────────────────────────────────────

function parseStructFields(structType: string): { name: string; type: string }[] {
  const inner = structType.match(/^STRUCT\((.+)\)$/s)?.[1];
  if (!inner) return [];
  const fields: { name: string; type: string }[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) {
      fields.push(parseField(inner.slice(start, i).trim()));
      start = i + 1;
    }
  }
  fields.push(parseField(inner.slice(start).trim()));
  return fields;
}

function parseField(s: string): { name: string; type: string } {
  const m = s.match(/^"?(\w+)"?\s+(.+)$/);
  return m ? { name: m[1], type: m[2] } : { name: s, type: 'VARCHAR' };
}

/** Expand STRUCT columns into flat dot-notation columns. */
function expandColumns(rawCols: ColumnInfo[]): {
  flatColumns: ColumnInfo[];
  selectExprs: string[];
} {
  const flatColumns: ColumnInfo[] = [];
  const selectExprs: string[] = [];

  for (const c of rawCols) {
    if (c.type.startsWith('STRUCT(')) {
      for (const f of parseStructFields(c.type)) {
        const flatName = `${c.name}.${f.name}`;
        flatColumns.push({ name: flatName, type: f.type });
        selectExprs.push(`"${c.name}"."${f.name}" AS "${flatName}"`);
      }
    } else {
      flatColumns.push(c);
      selectExprs.push(`"${c.name}"`);
    }
  }

  return { flatColumns, selectExprs };
}

/** Convert a flat column name (possibly dot-notation) to SQL expression. */
function colToSql(name: string): string {
  const dot = name.indexOf('.');
  return dot >= 0 ? `"${name.slice(0, dot)}"."${name.slice(dot + 1)}"` : `"${name}"`;
}

// ── File registration tracking ────────────────────────────

let _registeredParquetUrl: string | null = null;

// ── Hook ─────────────────────────────────────────────────

export function useParquetPreview(fileId: string) {
  const [status,            setStatus]            = useState<ParquetStatus>('polling');
  const [columns,           setColumns]           = useState<ColumnInfo[]>([]);
  const [totalRows,         setTotalRows]         = useState(0);
  const [filteredCount,     setFilteredCount]     = useState(0);
  const [columnStats,       setColumnStats]       = useState<Record<string, ColumnStats>>({});
  const [columnCardinality, setColumnCardinality] = useState<Record<string, ColumnCardinality>>({});
  const [error,             setError]             = useState<string | null>(null);
  const [isQuerying,        setIsQuerying]        = useState(false);
  const [cacheGen,          setCacheGen]          = useState(0);

  // Row cache: offset → row data
  const rowCache = useRef<Map<number, Record<string, unknown>>>(new Map());
  const filtersRef = useRef<FilterSpec[]>([]);
  const sortRef = useRef<SortSpec | null>(null);
  const selectListRef = useRef<string>('*');

  // ── Poll for Parquet URL, then init DuckDB ─────────────

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await apiFetch(`/api/files/${fileId}/parquet-url`);
        const data = await res.json();

        if (cancelled) return;

        if (data.status === 'ready') {
          await initDuckDb(data.url);
        } else if (data.status === 'converting') {
          setStatus('polling');
          pollTimer = setTimeout(poll, 2000);
        } else if (data.status === 'failed') {
          setStatus('failed');
        } else {
          setStatus('unavailable');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    }

    async function initDuckDb(parquetUrl: string) {
      try {
        setStatus('initializing');

        let db, conn;
        try {
          ({ db, conn } = await ensureDb());
        } catch (bootErr) {
          throw new Error(`DuckDB WASM failed to initialize: ${bootErr instanceof Error ? bootErr.message : String(bootErr)}`);
        }

        if (cancelled) return;

        setStatus('loading');

        // Register the Parquet file for HTTP range requests.
        // Always drop first — presigned URLs rotate and React can re-run effects.
        if (_registeredParquetUrl !== parquetUrl) {
          try {
            try { await db.dropFile('preview.parquet'); } catch { /* not registered — fine */ }
            await db.registerFileURL(
              'preview.parquet',
              parquetUrl,
              duckdb.DuckDBDataProtocol.HTTP,
              true,
            );
            _registeredParquetUrl = parquetUrl;
          } catch (regErr) {
            _registeredParquetUrl = null;
            throw new Error(`Failed to load dataset: ${regErr instanceof Error ? regErr.message : String(regErr)}`);
          }
        }

        // Schema from Parquet footer (instant — no data scan)
        let desc;
        try {
          desc = await conn.query(
            `DESCRIBE SELECT * FROM read_parquet('preview.parquet')`
          );
        } catch (footerErr) {
          _registeredParquetUrl = null;
          throw new Error(`Failed to read dataset metadata: ${footerErr instanceof Error ? footerErr.message : String(footerErr)}`);
        }
        const rawCols: ColumnInfo[] = desc.toArray().map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return { name: String(row.column_name), type: String(row.column_type) };
        });

        // Expand STRUCT columns into flat dot-notation columns
        const { flatColumns: cols, selectExprs } = expandColumns(rawCols);
        selectListRef.current = selectExprs.join(', ');

        if (cancelled) return;

        // Total row count from Parquet metadata (no data scan)
        const countResult = await conn.query(
          `SELECT COUNT(*)::INTEGER AS n FROM read_parquet('preview.parquet')`
        );
        const total = Number((countResult.toArray()[0] as Record<string, unknown>).n);

        if (cancelled) return;

        // Global min/max stats for numeric columns (from row group stats — no data scan)
        const numericCols = cols.filter(c => isNumericType(c.type));
        const stats: Record<string, ColumnStats> = {};

        if (numericCols.length > 0) {
          const selectParts = numericCols.flatMap(c => [
            `MIN(${colToSql(c.name)})::DOUBLE AS "${c.name}_min"`,
            `MAX(${colToSql(c.name)})::DOUBLE AS "${c.name}_max"`,
          ]);
          const statsResult = await conn.query(
            `SELECT ${selectParts.join(', ')} FROM read_parquet('preview.parquet')`
          );
          const statsRow = statsResult.toArray()[0] as Record<string, unknown>;
          for (const c of numericCols) {
            const min = Number(statsRow[`${c.name}_min`]);
            const max = Number(statsRow[`${c.name}_max`]);
            if (!isNaN(min) && !isNaN(max)) stats[c.name] = { min, max };
          }
        }

        if (cancelled) return;

        // Cardinality for non-numeric columns
        const cardinality: Record<string, ColumnCardinality> = {};
        const cardTargets: { path: string; sqlExpr: string }[] = [];

        for (const c of cols) {
          if (!isNumericType(c.type)) {
            cardTargets.push({ path: c.name, sqlExpr: colToSql(c.name) });
          }
        }

        if (cardTargets.length > 0) {
          const selectParts = cardTargets.map(
            (t, i) => `COUNT(DISTINCT ${t.sqlExpr}::VARCHAR)::INTEGER AS c${i}`
          );
          const cardResult = await conn.query(
            `SELECT ${selectParts.join(', ')} FROM read_parquet('preview.parquet')`
          );
          const cardRow = cardResult.toArray()[0] as Record<string, unknown>;

          const lowCardTargets = cardTargets.filter((_, i) => {
            const n = Number(cardRow[`c${i}`]);
            return n >= 1 && n <= DROPDOWN_MAX;
          });

          const valueResults: Record<string, string[]> = {};
          await Promise.all(lowCardTargets.map(async (t) => {
            const vResult = await conn.query(
              `SELECT DISTINCT ${t.sqlExpr}::VARCHAR AS v FROM read_parquet('preview.parquet') ORDER BY v`
            );
            valueResults[t.path] = vResult.toArray().map(
              (r: unknown) => String((r as Record<string, unknown>).v ?? '')
            );
          }));

          for (let i = 0; i < cardTargets.length; i++) {
            const t = cardTargets[i];
            const n = Number(cardRow[`c${i}`]);
            cardinality[t.path] = { distinct: n, values: valueResults[t.path] ?? [] };
          }
        }

        if (!cancelled) {
          setColumns(cols);
          setTotalRows(total);
          setFilteredCount(total);
          setColumnStats(stats);
          setColumnCardinality(cardinality);
          rowCache.current.clear();
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
    };
  }, [fileId]);

  // ── Fetch a window of rows ──────────────────────────────

  const fetchWindow = useCallback(async (
    offset: number,
    limit: number,
  ): Promise<Record<string, unknown>[]> => {
    // Return cached rows if available
    const cached: Record<string, unknown>[] = [];
    let allCached = true;
    for (let i = offset; i < offset + limit; i++) {
      const row = rowCache.current.get(i);
      if (row) {
        cached.push(row);
      } else {
        allCached = false;
        break;
      }
    }
    if (allCached && cached.length === limit) return cached;

    const { conn } = await ensureDb();
    const { clause, params, nextIdx } = compileWhere(filtersRef.current);
    const orderBy = sortRef.current
      ? `ORDER BY ${colToSql(sortRef.current.column)} ${sortRef.current.direction.toUpperCase()}`
      : '';

    const result = await execQuery(conn, {
      sql: `SELECT ${selectListRef.current} FROM ${PARQUET_SRC} ${clause} ${orderBy} LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      params: [...params, limit, offset],
    });

    const rows = result.toArray().map(
      (r: unknown) => coerceBigInts(r) as Record<string, unknown>
    );

    // Cache the fetched rows
    for (let i = 0; i < rows.length; i++) {
      rowCache.current.set(offset + i, rows[i]);
    }

    return rows;
  }, []);

  // ── Apply filters ───────────────────────────────────────

  const applyFilters = useCallback(async (
    filters: FilterSpec[],
    sort: SortSpec | null,
  ): Promise<{
    filteredCount: number;
    constrainedStats?: Record<string, ColumnStats>;
  }> => {
    setIsQuerying(true);
    try {
      filtersRef.current = filters;
      sortRef.current = sort;
      rowCache.current.clear();
      setCacheGen(g => g + 1);

      const { conn } = await ensureDb();
      const { clause, params } = compileWhere(filters);

      // Count + constrained stats in parallel (same WHERE params for both)
      const numericCols = columns.filter(c => isNumericType(c.type));
      const conParts = filters.length > 0 && numericCols.length > 0
        ? numericCols.flatMap(c => [
            `MIN(${colToSql(c.name)})::DOUBLE AS "${c.name}_min"`,
            `MAX(${colToSql(c.name)})::DOUBLE AS "${c.name}_max"`,
          ])
        : null;

      const [countRes, conRes] = await Promise.all([
        execQuery(conn, {
          sql: `SELECT COUNT(*)::INTEGER AS n FROM ${PARQUET_SRC} ${clause}`,
          params,
        }),
        conParts
          ? execQuery(conn, {
              sql: `SELECT ${conParts.join(', ')} FROM ${PARQUET_SRC} ${clause}`,
              params,
            })
          : Promise.resolve(null),
      ]);

      const count = Number((countRes.toArray()[0] as Record<string, unknown>).n);
      setFilteredCount(count);

      let constrainedStats: Record<string, ColumnStats> | undefined;
      if (conRes) {
        const row = conRes.toArray()[0] as Record<string, unknown> | undefined;
        if (row) {
          constrainedStats = {};
          for (const c of numericCols) {
            const mn = Number(row[`${c.name}_min`]);
            const mx = Number(row[`${c.name}_max`]);
            if (!isNaN(mn) && !isNaN(mx)) constrainedStats[c.name] = { min: mn, max: mx };
          }
        }
      }

      return { filteredCount: count, constrainedStats };
    } finally {
      setIsQuerying(false);
    }
  }, [columns]);

  return {
    status,
    columns,
    totalRows,
    filteredCount,
    columnStats,
    columnCardinality,
    error,
    fetchWindow,
    applyFilters,
    isQuerying,
    cacheGen,
  };
}

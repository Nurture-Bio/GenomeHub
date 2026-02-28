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

export interface FilterSpec {
  column: string;
  expr: string;  // SQL expression fragment, e.g. "BETWEEN 0 AND 100"
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
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

  // Row cache: offset → row data
  const rowCache = useRef<Map<number, Record<string, unknown>>>(new Map());
  const filtersRef = useRef<FilterSpec[]>([]);
  const sortRef = useRef<SortSpec | null>(null);

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

        // Register the Parquet file for HTTP range requests
        if (_registeredParquetUrl !== parquetUrl) {
          try {
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
        const cols: ColumnInfo[] = desc.toArray().map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return { name: String(row.column_name), type: String(row.column_type) };
        });

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
            `MIN("${c.name}")::DOUBLE AS "${c.name}_min"`,
            `MAX("${c.name}")::DOUBLE AS "${c.name}_max"`,
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
          if (c.type.startsWith('STRUCT(')) {
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

  // ── Build WHERE clause from filters ─────────────────────

  const buildWhere = useCallback((filters: FilterSpec[]): string => {
    if (filters.length === 0) return '';
    const conditions = filters.map(f => {
      const dot = f.column.indexOf('.');
      const quoted = dot >= 0
        ? `"${f.column.slice(0, dot)}".${f.column.slice(dot + 1)}`
        : `"${f.column}"`;
      return `(${quoted} ${f.expr})`;
    });
    return `WHERE ${conditions.join(' AND ')}`;
  }, []);

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
    const where = buildWhere(filtersRef.current);
    const orderBy = sortRef.current
      ? `ORDER BY "${sortRef.current.column}" ${sortRef.current.direction.toUpperCase()}`
      : '';

    const result = await conn.query(
      `SELECT * FROM read_parquet('preview.parquet') ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`
    );

    const rows = result.toArray().map(
      (r: unknown) => coerceBigInts(r) as Record<string, unknown>
    );

    // Cache the fetched rows
    for (let i = 0; i < rows.length; i++) {
      rowCache.current.set(offset + i, rows[i]);
    }

    return rows;
  }, [buildWhere]);

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

      const { conn } = await ensureDb();
      const where = buildWhere(filters);

      // Count + constrained stats in parallel
      const numericCols = columns.filter(c => isNumericType(c.type));
      const conParts = filters.length > 0 && numericCols.length > 0
        ? numericCols.flatMap(c => [
            `MIN("${c.name}")::DOUBLE AS "${c.name}_min"`,
            `MAX("${c.name}")::DOUBLE AS "${c.name}_max"`,
          ])
        : null;

      const [countRes, conRes] = await Promise.all([
        conn.query(`SELECT COUNT(*)::INTEGER AS n FROM read_parquet('preview.parquet') ${where}`),
        conParts
          ? conn.query(`SELECT ${conParts.join(', ')} FROM read_parquet('preview.parquet') ${where}`)
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
  }, [columns, buildWhere]);

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
  };
}

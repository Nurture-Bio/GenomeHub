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
import { useAppStore } from '../stores/useAppStore.js';
import type { DataProfile } from '@genome-hub/shared';

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

/** Profile axis — driven by parquet-url server response. */
export type ProfileStatus =
  | 'polling'       // waiting for Parquet conversion
  | 'ready'         // baseProfile arrived (schema + rowCount + cached attrs)
  | 'unavailable'   // no Parquet available
  | 'failed'        // conversion failed
  | 'error';

/** WASM axis — DuckDB boot + file registration. */
export type WasmStatus =
  | 'idle'           // waiting for parquet URL
  | 'booting'        // ensureDb() in progress
  | 'registering'    // registerFileURL in progress
  | 'ready'          // fetchWindow/applyFilters available
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
  // Profile axis (fast — driven by server response)
  const [profileStatus,     setProfileStatus]     = useState<ProfileStatus>('polling');
  const [columns,           setColumns]           = useState<ColumnInfo[]>([]);
  const [totalRows,         setTotalRows]         = useState(0);
  const [filteredCount,     setFilteredCount]     = useState(0);
  const [baseProfile,       setBaseProfile]       = useState<DataProfile | null>(null);
  const [error,             setError]             = useState<string | null>(null);

  // WASM axis (slow — DuckDB boot + file registration)
  const [wasmStatus,        setWasmStatus]        = useState<WasmStatus>('idle');
  const [wasmError,         setWasmError]         = useState<string | null>(null);
  const wasmStatusRef = useRef<WasmStatus>('idle');

  const [isQuerying,        setIsQuerying]        = useState(false);
  const [cacheGen,          setCacheGen]          = useState(0);

  // Row cache: offset → row data
  const rowCache = useRef<Map<number, Record<string, unknown>>>(new Map());
  const filtersRef = useRef<FilterSpec[]>([]);
  const sortRef = useRef<SortSpec | null>(null);
  const selectListRef = useRef<string>('*');

  // ── Check Zustand store first, then poll API ──

  const { getValidFileProfile, setFileProfile, mergeFileProfile } = useAppStore();

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    /** Hydrate profile axis from a DataProfile (store or server). */
    function hydrateProfile(profile: DataProfile) {
      setBaseProfile(profile);
      if (profile.schema?.length) {
        const rawCols = profile.schema.map((c: { name: string; type: string }) => ({
          name: c.name, type: c.type,
        }));
        const { flatColumns: cols, selectExprs } = expandColumns(rawCols);
        selectListRef.current = selectExprs.join(', ');
        setColumns(cols);
        setTotalRows(profile.rowCount);
        setFilteredCount(profile.rowCount);
      }
      setProfileStatus('ready');
    }

    // ── Fast path: Zustand store has a valid cached entry with parquetUrl ──
    const cached = getValidFileProfile(fileId);
    if (cached?.parquetUrl) {
      hydrateProfile(cached.dataProfile);
      initWasm(cached.parquetUrl, cached.dataProfile);
      return () => { cancelled = true; };
    }

    // ── Medium path: profile primed from file list, but no parquetUrl yet ──
    // Hydrate sidebar immediately, then fetch parquet-url for WASM only.
    if (cached && !cached.parquetUrl) {
      hydrateProfile(cached.dataProfile);
    }

    // ── Slow path: fetch parquet-url from server ──
    async function poll() {
      try {
        const res = await apiFetch(`/api/files/${fileId}/parquet-url`);
        const data = await res.json();

        if (cancelled) return;

        if (data.status === 'ready') {
          const serverProfile: DataProfile | null = data.dataProfile ?? null;

          // ── Phase 1: Profile (immediate, no WASM needed) ──
          // Skip if already hydrated from Zustand cache above
          if (!cached) {
            if (serverProfile) {
              hydrateProfile(serverProfile);
            } else {
              setProfileStatus('ready');
            }
          }

          // Write full entry (with parquetUrl) to Zustand
          setFileProfile(fileId, {
            dataProfile: serverProfile ?? cached?.dataProfile ?? { schema: [], rowCount: 0 },
            parquetUrl: data.url,
            cachedAt: Date.now(),
          });

          // ── Phase 2: WASM (background, async) ──
          initWasm(data.url, serverProfile ?? cached?.dataProfile ?? null);

        } else if (data.status === 'converting') {
          setProfileStatus('polling');
          pollTimer = setTimeout(poll, 2000);
        } else if (data.status === 'failed') {
          setProfileStatus('failed');
        } else {
          setProfileStatus('unavailable');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setProfileStatus('error');
        }
      }
    }

    async function initWasm(parquetUrl: string, serverProfile: DataProfile | null) {
      try {
        setWasmStatus('booting');
        wasmStatusRef.current = 'booting';

        let db, conn;
        try {
          ({ db, conn } = await ensureDb());
        } catch (bootErr) {
          throw new Error(`DuckDB WASM failed to initialize: ${bootErr instanceof Error ? bootErr.message : String(bootErr)}`);
        }

        if (cancelled) return;

        setWasmStatus('registering');
        wasmStatusRef.current = 'registering';

        // Register the Parquet file for HTTP range requests.
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

        // Edge case: no schema from server — read from Parquet footer via WASM
        if (!serverProfile?.schema?.length) {
          let desc;
          try {
            desc = await conn.query(
              `DESCRIBE SELECT * FROM read_parquet('preview.parquet')`
            );
          } catch (footerErr) {
            _registeredParquetUrl = null;
            throw new Error(`Failed to read dataset metadata: ${footerErr instanceof Error ? footerErr.message : String(footerErr)}`);
          }
          const rawCols = desc.toArray().map((r: unknown) => {
            const row = r as Record<string, unknown>;
            return { name: String(row.column_name), type: String(row.column_type) };
          });

          const countResult = await conn.query(
            `SELECT COUNT(*)::INTEGER AS n FROM read_parquet('preview.parquet')`
          );
          const total = Number((countResult.toArray()[0] as Record<string, unknown>).n);

          const { flatColumns: cols, selectExprs } = expandColumns(rawCols);
          selectListRef.current = selectExprs.join(', ');

          if (!cancelled) {
            setColumns(cols);
            setTotalRows(total);
            setFilteredCount(total);
          }
        }

        if (cancelled) return;

        rowCache.current.clear();
        setWasmStatus('ready');
        wasmStatusRef.current = 'ready';
      } catch (err) {
        if (!cancelled) {
          setWasmError(err instanceof Error ? err.message : String(err));
          setWasmStatus('error');
          wasmStatusRef.current = 'error';
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
    if (wasmStatusRef.current !== 'ready') return [];

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
    if (wasmStatusRef.current !== 'ready') return { filteredCount: 0 };

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
    // Profile axis (fast)
    profileStatus,
    columns,
    totalRows,
    filteredCount,
    baseProfile,
    error,

    // WASM axis (slow)
    wasmReady: wasmStatus === 'ready',
    wasmStatus,
    wasmError,

    // Row-level operations (require WASM)
    fetchWindow,
    applyFilters,
    isQuerying,
    cacheGen,
  };
}

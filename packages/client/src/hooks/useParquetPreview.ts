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

export function isNumericType(type: string | null | undefined): boolean {
  if (!type) return false;
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
    const colType = c.type || 'VARCHAR';
    if (colType.startsWith('STRUCT(')) {
      for (const f of parseStructFields(colType)) {
        const flatName = `${c.name}.${f.name}`;
        flatColumns.push({ name: flatName, type: f.type });
        selectExprs.push(`"${c.name}"."${f.name}" AS "${flatName}"`);
      }
    } else {
      flatColumns.push({ name: c.name, type: colType });
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
  const { getValidFileProfile, setFileProfile, mergeFileProfile } = useAppStore();

  // ── Synchronous Zustand read — runs DURING useState, before first render ──
  const cachedEntry = getValidFileProfile(fileId);
  const cachedProfile = cachedEntry?.dataProfile ?? null;
  const cachedExpanded = cachedProfile?.schema?.length
    ? expandColumns(cachedProfile.schema.map((c: { name: string; type: string }) => ({ name: c.name, type: c.type || 'VARCHAR' })))
    : null;

  console.log('[PQ:mount]', {
    hasCachedEntry: !!cachedEntry,
    hasCachedProfile: !!cachedProfile,
    cachedCols: cachedExpanded?.flatColumns.length ?? 0,
    cachedUrl: !!cachedEntry?.parquetUrl,
  });

  // Profile axis — seeded from Zustand if available, NOT from a useEffect
  const [profileStatus,     setProfileStatus]     = useState<ProfileStatus>(cachedProfile ? 'ready' : 'polling');
  const [columns,           setColumns]           = useState<ColumnInfo[]>(cachedExpanded?.flatColumns ?? []);
  const [totalRows,         setTotalRows]         = useState(cachedProfile?.rowCount ?? 0);
  const [filteredCount,     setFilteredCount]     = useState(cachedProfile?.rowCount ?? 0);
  const [baseProfile,       setBaseProfile]       = useState<DataProfile | null>(cachedProfile);
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
  const sortRef = useRef<SortSpec[]>([]);
  const selectListRef = useRef<string>(cachedExpanded?.selectExprs.join(', ') ?? '*');

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    /** Hydrate profile axis from a DataProfile (for slow path only). */
    function hydrateProfile(profile: DataProfile) {
      console.log('[PQ:hydrateProfile]', {
        schemaCols: profile.schema?.length ?? 0,
        rowCount: profile.rowCount,
        hasStats: !!profile.columnStats,
        hasCardinality: !!profile.cardinality,
      });
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

    // ── Fast path: Zustand has profile + parquetUrl ──
    // State already seeded in useState above — just kick off WASM.
    if (cachedEntry?.parquetUrl) {
      console.log('[PQ:fastPath] Zustand has URL, skipping poll, going to initWasm');
      initWasm(cachedEntry.parquetUrl, cachedProfile);
      return () => { cancelled = true; };
    }

    // ── Medium path: Zustand has profile but no parquetUrl ──
    // State already seeded in useState above — just fetch the presigned URL.
    // Fall through to poll().

    // ── Slow path (or medium path URL fetch): hit the server ──
    async function poll() {
      console.log('[PQ:poll] Fetching parquet-url...');
      try {
        const res = await apiFetch(`/api/files/${fileId}/parquet-url`);
        const data = await res.json();

        if (cancelled) return;
        console.log('[PQ:poll] Response:', {
          status: data.status,
          hasProfile: !!data.dataProfile,
          profileKeys: data.dataProfile ? Object.keys(data.dataProfile) : [],
          schemaCols: data.dataProfile?.schema?.length ?? 0,
        });

        if (data.status === 'ready') {
          const serverProfile: DataProfile | null = data.dataProfile ?? null;

          // Only hydrate profile if we didn't already seed from Zustand
          if (!cachedProfile) {
            console.log('[PQ:poll] No cached profile, hydrating from server');
            if (serverProfile) {
              hydrateProfile(serverProfile);
            } else {
              console.log('[PQ:poll] No server profile either, setting ready with no data');
              setProfileStatus('ready');
            }
          } else {
            console.log('[PQ:poll] Already have cached profile, skipping hydrate');
          }

          // Resolve relative URLs to absolute (local dev serves /api/storage/...)
          const parquetUrl = data.url.startsWith('/')
            ? `${window.location.origin}${data.url}`
            : data.url;

          // Write full entry (with parquetUrl) to Zustand
          setFileProfile(fileId, {
            dataProfile: serverProfile ?? cachedProfile ?? { schema: [], rowCount: 0 },
            parquetUrl,
            cachedAt: Date.now(),
          });

          // WASM boot (background)
          initWasm(parquetUrl, serverProfile ?? cachedProfile ?? null);

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
      console.log('[PQ:wasm] Starting WASM init', {
        serverSchemaCols: serverProfile?.schema?.length ?? 0,
      });
      try {
        // Only update wasmStatusRef during boot — don't call setWasmStatus
        // for intermediate states. Each setState after an await creates a new
        // microtask → separate React render → unnecessary layout thrash.
        // Only set React state at the end (ready/error).
        console.log('[PQ:wasm] → booting');
        wasmStatusRef.current = 'booting';

        let db, conn;
        try {
          ({ db, conn } = await ensureDb());
        } catch (bootErr) {
          throw new Error(`DuckDB WASM failed to initialize: ${bootErr instanceof Error ? bootErr.message : String(bootErr)}`);
        }

        if (cancelled) return;

        console.log('[PQ:wasm] → registering');
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

        // Always read actual schema from Parquet footer — server profile may be stale
        {
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

          const { flatColumns: cols, selectExprs } = expandColumns(rawCols);
          selectListRef.current = selectExprs.join(', ');
          console.log('[PQ:wasm] DESCRIBE returned', cols.length, 'columns:', cols.map(c => c.name).join(', '));

          // Only update columns state if the actual data changed —
          // prevents unnecessary re-renders that cause sidebar flashing.
          const stableSetColumns = (next: ColumnInfo[]) => {
            setColumns(prev => {
              const same = prev.length === next.length &&
                  prev.every((c, i) => c.name === next[i].name && c.type === next[i].type);
              console.log('[PQ:wasm] stableSetColumns:', same ? 'SAME (no re-render)' : 'CHANGED (will re-render)');
              return same ? prev : next;
            });
          };

          if (!serverProfile?.schema?.length) {
            console.log('[PQ:wasm] No server schema, reading count from WASM');
            // No server schema — read row count from WASM too
            const countResult = await conn.query(
              `SELECT COUNT(*)::INTEGER AS n FROM read_parquet('preview.parquet')`
            );
            const total = Number((countResult.toArray()[0] as Record<string, unknown>).n);
            if (!cancelled) {
              stableSetColumns(cols);
              setTotalRows(total);
              setFilteredCount(total);
            }
          } else if (!cancelled) {
            stableSetColumns(cols);

            // Check if server schema is stale (different columns than actual file)
            // Compare RAW columns (before STRUCT expansion) against server schema
            // — both are from DESCRIBE SELECT * and should match exactly.
            // Using expanded cols here would always mismatch for STRUCT columns
            // (e.g. 26 expanded vs 7 raw), triggering reprofile every page load.
            const actualNames = new Set(rawCols.map(c => c.name));
            const serverNames = new Set(
              serverProfile.schema.map((c: { name: string }) => c.name)
            );
            const stale = actualNames.size !== serverNames.size ||
              [...actualNames].some(n => !serverNames.has(n));
            console.log('[PQ:wasm] Schema comparison:', { stale, actual: actualNames.size, server: serverNames.size, actualCols: [...actualNames], serverCols: [...serverNames] });

            if (stale) {
              console.log('[PQ:wasm] STALE schema detected, firing background reprofile');
              // Server profile has wrong columns — reprofile in the background.
              // Do NOT strip enriched attrs (that causes a visual flash).
              apiFetch(`/api/files/${fileId}/reprofile`, { method: 'POST' })
                .then(r => r.json())
                .then(data => {
                  if (cancelled || !data.profile) return;
                  setBaseProfile(data.profile);
                  setFileProfile(fileId, {
                    dataProfile: data.profile,
                    parquetUrl: _registeredParquetUrl!,
                    cachedAt: Date.now(),
                  });
                })
                .catch(() => {}); // non-fatal
            }
          }
        }

        if (cancelled) return;

        rowCache.current.clear();
        console.log('[PQ:wasm] → ready');
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
    const orderBy = sortRef.current.length > 0
      ? `ORDER BY ${sortRef.current.map(s =>
          `${colToSql(s.column)} ${s.direction.toUpperCase()}`
        ).join(', ')}`
      : '';

    const result = await execQuery(conn, {
      sql: `SELECT ${selectListRef.current} FROM ${PARQUET_SRC} ${clause} ${orderBy} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params,
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
    sort: SortSpec[],
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

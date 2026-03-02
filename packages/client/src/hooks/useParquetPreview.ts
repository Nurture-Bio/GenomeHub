/**
 * useParquetPreview — DuckDB WASM over Parquet via HTTP range requests.
 *
 * Pipeline state is managed by a strict useReducer. All UI-visible transitions
 * flow through `dispatch(signal)`. The core invariant:
 *
 *   If status is 'ready_background_work' or 'ready', the reducer IGNORES
 *   any signal that would regress the UI (WASM_BOOTING, FATAL_ERROR).
 *
 * @module
 */

import { useEffect, useReducer, useState, useCallback, useRef } from 'react';
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

// ── Pipeline State Machine ───────────────────────────────

export type PipelineStatus =
  | 'idle'
  | 'loading'
  | 'ready_background_work'  // data visible, WASM still booting
  | 'ready'                  // WASM fully operational
  | 'unavailable'
  | 'failed'
  | 'error';

export interface PipelineState {
  activeStep: 0 | 1 | 2 | 3 | 4;
  status: PipelineStatus;
  error: string | null;
}

export type PipelineSignal =
  | { type: 'START_POLL' }
  | { type: 'PREFLIGHT_DATA_READY' }
  | { type: 'WASM_BOOTING' }
  | { type: 'WASM_READY' }
  | { type: 'UNAVAILABLE' }
  | { type: 'CONVERSION_FAILED' }
  | { type: 'FATAL_ERROR'; payload: string };

function pipelineReducer(state: PipelineState, signal: PipelineSignal): PipelineState {
  switch (signal.type) {
    case 'START_POLL':
      return state.status === 'idle'
        ? { activeStep: 0, status: 'loading', error: null }
        : state;

    case 'PREFLIGHT_DATA_READY':
      // Pre-flight data is king — jump straight to step 4
      return { activeStep: 4, status: 'ready_background_work', error: null };

    case 'WASM_BOOTING':
      // If data is already visible, WASM is background plumbing — never regress
      if (state.status === 'ready_background_work' || state.status === 'ready') return state;
      return { activeStep: 1, status: 'loading', error: null };

    case 'WASM_READY':
      return { activeStep: 4, status: 'ready', error: null };

    case 'UNAVAILABLE':
      return { activeStep: 0, status: 'unavailable', error: null };

    case 'CONVERSION_FAILED':
      return { activeStep: 0, status: 'failed', error: null };

    case 'FATAL_ERROR':
      // Data wins — if rows are painted, suppress the error in UI
      if (state.status === 'ready_background_work' || state.status === 'ready') return state;
      return { ...state, status: 'error', error: signal.payload };
  }
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

  if (!cachedEntry) {
    console.warn('[PQ:mount] No Zustand cache — cold start (poll path). If this fires on SPA navigation, the cache TTL expired or was never set.');
  }
  console.log('[PQ:mount]', {
    hasCachedEntry: !!cachedEntry,
    hasCachedProfile: !!cachedProfile,
    cachedCols: cachedExpanded?.flatColumns.length ?? 0,
    cachedUrl: !!cachedEntry?.parquetUrl,
  });

  // ── Pipeline reducer — single source of truth for UI state ──
  const initialPipeline: PipelineState = cachedEntry?.parquetUrl
    ? { activeStep: 4, status: 'ready_background_work', error: null }
    : { activeStep: 0, status: 'idle', error: null };
  const [pipeline, dispatch] = useReducer(pipelineReducer, initialPipeline);

  // Data state — NOT machine state, just values
  const [columns,       setColumns]       = useState<ColumnInfo[]>(cachedExpanded?.flatColumns ?? []);
  const [totalRows,     setTotalRows]     = useState(cachedProfile?.rowCount ?? 0);
  const [filteredCount, setFilteredCount] = useState(cachedProfile?.rowCount ?? 0);
  const [baseProfile,   setBaseProfile]   = useState<DataProfile | null>(cachedProfile);
  const [isQuerying,    setIsQuerying]    = useState(false);
  const [cacheGen,      setCacheGen]      = useState(0);

  // Ref for fetchWindow/applyFilters gating — tracks real WASM state, not UI state
  const wasmStatusRef = useRef<'idle' | 'booting' | 'registering' | 'ready' | 'error'>('idle');

  // Row cache: offset → row data
  const rowCache = useRef<Map<number, Record<string, unknown>>>(new Map());
  const isCacheSeeded = useRef(false);

  // Synchronously seed from Zustand on Frame 1 — before VirtualRows snapshots the cache.
  // initialRows is a persisted enrichable attribute in DataProfile (JSONB).
  if (!isCacheSeeded.current) {
    if (cachedProfile?.initialRows?.length) {
      for (let i = 0; i < cachedProfile.initialRows.length; i++) {
        rowCache.current.set(i, cachedProfile.initialRows[i]);
      }
    }
    isCacheSeeded.current = true;
  }

  const filtersRef = useRef<FilterSpec[]>([]);
  const sortRef = useRef<SortSpec[]>([]);
  const selectListRef = useRef<string>(cachedExpanded?.selectExprs.join(', ') ?? '*');

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    /** Hydrate data state from a DataProfile (columns, totalRows, etc.) */
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
    }

    // ── Fast path: Zustand has profile + parquetUrl ──
    // Pipeline already initialized to ready_background_work. Just kick off WASM.
    // rowCache was already seeded synchronously above (before first render).
    if (cachedEntry?.parquetUrl) {
      console.log('[PQ:fastPath] Zustand has URL, skipping poll, going to initWasm', {
        warmRows: rowCache.current.size,
      });
      initWasm(cachedEntry.parquetUrl, cachedProfile);
      return () => { cancelled = true; };
    }

    // ── Slow path: hit the server ──
    async function poll() {
      console.log('[PQ:poll] Fetching parquet-url...');
      dispatch({ type: 'START_POLL' });
      try {
        const res = await apiFetch(`/api/files/${fileId}/parquet-url`);
        const data = await res.json();

        if (cancelled) return;
        console.log('[PQ:poll] Response:', {
          status: data.status,
          hasProfile: !!data.dataProfile,
          hasInitialRows: !!data.initialRows?.length,
          schemaCols: data.dataProfile?.schema?.length ?? 0,
        });

        if (data.status === 'ready') {
          const serverProfile: DataProfile | null = data.dataProfile ?? null;

          // Hydrate data state (columns, totalRows, etc.)
          if (!cachedProfile && serverProfile) {
            hydrateProfile(serverProfile);
          }

          // ── Pre-flight injection: seed cache from profile's initialRows ──
          const serverRows = serverProfile?.initialRows ?? null;
          if (serverRows?.length) {
            console.log(`[PQ:poll] Pre-flight: ${serverRows.length} rows from profile`);
            rowCache.current.clear();
            for (let i = 0; i < serverRows.length; i++) {
              rowCache.current.set(i, serverRows[i]);
            }
            const total = serverProfile?.rowCount ?? serverRows.length;
            setTotalRows(total);
            setFilteredCount(total);
            // Single atomic signal — UI jumps to step 4 in the same React batch
            dispatch({ type: 'PREFLIGHT_DATA_READY' });
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

          // WASM boot (background — WASM_BOOTING ignored if PREFLIGHT_DATA_READY already fired)
          initWasm(parquetUrl, serverProfile ?? cachedProfile ?? null);

        } else if (data.status === 'converting') {
          pollTimer = setTimeout(poll, 2000);
        } else if (data.status === 'failed') {
          dispatch({ type: 'CONVERSION_FAILED' });
        } else {
          dispatch({ type: 'UNAVAILABLE' });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({ type: 'FATAL_ERROR', payload: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    async function initWasm(parquetUrl: string, serverProfile: DataProfile | null) {
      const t0 = performance.now();
      console.log('[PQ:wasm] Starting WASM init', {
        parquetUrl,
        serverSchemaCols: serverProfile?.schema?.length ?? 0,
      });
      try {
        // Signal WASM_BOOTING — ignored if data is already visible
        dispatch({ type: 'WASM_BOOTING' });
        wasmStatusRef.current = 'booting';

        let db, conn;
        try {
          ({ db, conn } = await ensureDb());
        } catch (bootErr) {
          throw new Error(`DuckDB WASM failed to initialize: ${bootErr instanceof Error ? bootErr.message : String(bootErr)}`);
        }
        const tBoot = performance.now();
        console.log(`[PQ:perf] WASM Boot: ${(tBoot - t0).toFixed(1)}ms`);

        if (cancelled) return;

        wasmStatusRef.current = 'registering';

        // ── 1. ENSURE REGISTRATION ──────────────────────────────────
        if (_registeredParquetUrl !== parquetUrl) {
          console.log('[PQ:wasm] → registerFileURL (new URL)', { parquetUrl });
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

        // ── 2. VFS LIVENESS CHECK ───────────────────────────────────
        try {
          await conn.query(`SELECT 1 FROM read_parquet('preview.parquet') LIMIT 0`);
        } catch {
          console.log('[PQ:wasm] VFS stale — forcing re-registration');
          try { await db.dropFile('preview.parquet'); } catch { /* ignore */ }
          await db.registerFileURL(
            'preview.parquet',
            parquetUrl,
            duckdb.DuckDBDataProtocol.HTTP,
            true,
          );
          _registeredParquetUrl = parquetUrl;
        }

        console.log('[PQ:wasm] ✓ VFS ready');

        // ── 3. READ METADATA ────────────────────────────────────────
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

          const stableSetColumns = (next: ColumnInfo[]) => {
            setColumns(prev => {
              const same = prev.length === next.length &&
                  prev.every((c, i) => c.name === next[i].name && c.type === next[i].type);
              return same ? prev : next;
            });
          };

          if (!serverProfile?.schema?.length) {
            const countResult = await conn.query(
              `SELECT COUNT(*)::INTEGER AS n FROM read_parquet('preview.parquet')`
            );
            const total = Number((countResult.toArray()[0] as Record<string, unknown>).n);
            if (!cancelled) {
              stableSetColumns(cols);
              setTotalRows(total);
              setFilteredCount(total);
              console.log(`[PQ:perf] Parquet Register & Schema Read: ${(performance.now() - tBoot).toFixed(1)}ms`);
            }
          } else if (!cancelled) {
            stableSetColumns(cols);

            const actualNames = new Set(rawCols.map(c => c.name));
            const serverNames = new Set(
              serverProfile.schema.map((c: { name: string }) => c.name)
            );
            const stale = actualNames.size !== serverNames.size ||
              [...actualNames].some(n => !serverNames.has(n));
            console.log(`[PQ:perf] Parquet Register & Schema Read: ${(performance.now() - tBoot).toFixed(1)}ms`);

            if (stale) {
              console.log('[PQ:wasm] STALE schema detected, firing background reprofile');
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

        // ── 4. GREEDY FETCH ─────────────────────────────────────────
        {
          const tGreedy = performance.now();
          console.log('[PQ:wasm] → greedy fetch (100 rows + COUNT)');
          const greedy = `SELECT ${selectListRef.current} FROM ${PARQUET_SRC} LIMIT 100`;
          const countSql = `SELECT COUNT(*)::INTEGER AS n FROM ${PARQUET_SRC}`;
          const [rowResult, countResult] = await Promise.all([
            conn.query(greedy),
            conn.query(countSql),
          ]);
          if (cancelled) return;

          const rows = rowResult.toArray().map(
            (r: unknown) => coerceBigInts(r) as Record<string, unknown>,
          );
          for (let i = 0; i < rows.length; i++) {
            rowCache.current.set(i, rows[i]);
          }

          const total = Number((countResult.toArray()[0] as Record<string, unknown>).n);
          console.log(`[PQ:perf] Greedy Fetch: ${(performance.now() - tGreedy).toFixed(1)}ms (${rows.length} rows, ${total} total)`);
          setTotalRows(total);
          setFilteredCount(total);
        }

        // ── 5. WASM READY ───────────────────────────────────────────
        console.log('[PQ:wasm] → ready');
        wasmStatusRef.current = 'ready';
        dispatch({ type: 'WASM_READY' });
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          wasmStatusRef.current = 'error';
          // FATAL_ERROR is ignored by reducer if data is already visible
          dispatch({ type: 'FATAL_ERROR', payload: msg });
          console.warn('[PQ:wasm] Error:', msg);
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

  /** Synchronous snapshot of the warm rowCache — lets VirtualRows seed its
   *  initial state without waiting for an async fetchWindow round-trip. */
  const snapshotCache = useCallback((): Map<number, Record<string, unknown>> => {
    return new Map(rowCache.current);
  }, []);

  return {
    pipeline,
    columns,
    totalRows,
    filteredCount,
    baseProfile,
    fetchWindow,
    applyFilters,
    isQuerying,
    cacheGen,
    snapshotCache,
  };
}

// ── Hover Prefetch ────────────────────────────────────────

/** Module-level dedup — don't prefetch the same file twice. */
const _prefetching = new Set<string>();

/**
 * Fire-and-forget prefetch of the parquet-url endpoint.
 * Call from onMouseEnter on file list links. Warms both Zustand
 * (profile + parquetUrl + initialRows) and the DuckDB WASM singleton.
 */
export function prefetchParquetUrl(fileId: string): void {
  const { getValidFileProfile, setFileProfile } = useAppStore.getState();

  // Already cached or in-flight — skip
  if (getValidFileProfile(fileId) || _prefetching.has(fileId)) return;

  _prefetching.add(fileId);

  // Warm the WASM singleton in parallel — idempotent, ~0ms if already booted
  ensureDb().catch(() => {});

  apiFetch(`/api/files/${fileId}/parquet-url`)
    .then(res => res.json())
    .then(data => {
      if (data.status !== 'ready') return;

      const serverProfile = data.dataProfile ?? null;
      const parquetUrl = data.url.startsWith('/')
        ? `${window.location.origin}${data.url}`
        : data.url;

      setFileProfile(fileId, {
        dataProfile: serverProfile ?? { schema: [], rowCount: 0 },
        parquetUrl,
        cachedAt: Date.now(),
      });
    })
    .catch(() => {}) // non-fatal
    .finally(() => _prefetching.delete(fileId));
}

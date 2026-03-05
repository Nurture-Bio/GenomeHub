/**
 * useFileQuery — Streaming query engine over server-side DuckDB/Parquet.
 *
 * All DuckDB computation happens server-side via POST /api/files/:id/query.
 * The hook manages query lifecycle (polling, streaming Arrow IPC, caching)
 * and synchronizes with the server. Stale responses are discarded via
 * AbortController.
 *
 * @module
 */

import { useEffect, useReducer, useState, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { useAppStore } from '../stores/useAppStore.js';
import type { DataProfile, FilterSpec, SortSpec } from '@genome-hub/shared';

// Re-export shared types for downstream consumers
export type { FilterSpec, SortSpec } from '@genome-hub/shared';
export type { FilterOp } from '@genome-hub/shared';

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

// ── Query State Machine ──────────────────────────────────

export type QueryPhase =
  | 'idle'
  | 'loading'
  | 'ready_background_work' // data visible, server still hydrating profile
  | 'ready' // fully operational
  | 'unavailable'
  | 'failed'
  | 'error';

export interface QuerySnapshot {
  count: number;
  total: number;
  stats: Record<string, { min: number; max: number }>;
  histograms: Record<string, number[]>;
}

export interface QueryState {
  activeStep: 0 | 1 | 2 | 3 | 4;
  phase: QueryPhase;
  error: string | null;
  queryError: Error | string | null;
  isQuerying: boolean;
  snapshot: QuerySnapshot;
}

export type QueryAction =
  | { type: 'START_POLL' }
  | { type: 'PREFLIGHT_DATA_READY' }
  | { type: 'SERVER_READY' }
  | { type: 'UNAVAILABLE' }
  | { type: 'CONVERSION_FAILED' }
  | { type: 'FATAL_ERROR'; payload: string }
  | { type: 'START_QUERY' }
  | { type: 'QUERY_DATA'; payload: Partial<QuerySnapshot> & { done?: boolean } }
  | { type: 'QUERY_ERROR'; payload: Error | string };

function queryReducer(state: QueryState, signal: QueryAction): QueryState {
  switch (signal.type) {
    case 'START_POLL':
      return state.phase === 'idle'
        ? { activeStep: 0, phase: 'loading', error: null, queryError: null, isQuerying: false, snapshot: state.snapshot }
        : state;

    case 'PREFLIGHT_DATA_READY':
      return { ...state, activeStep: 4, phase: 'ready_background_work', error: null };

    case 'SERVER_READY':
      return { ...state, activeStep: 4, phase: 'ready', error: null };

    case 'UNAVAILABLE':
      return { activeStep: 0, phase: 'unavailable', error: null, queryError: null, isQuerying: false, snapshot: state.snapshot };

    case 'CONVERSION_FAILED':
      return { activeStep: 0, phase: 'failed', error: null, queryError: null, isQuerying: false, snapshot: state.snapshot };

    case 'FATAL_ERROR':
      if (state.phase === 'ready_background_work' || state.phase === 'ready') return state;
      return { ...state, phase: 'error', error: signal.payload, isQuerying: false };

    case 'START_QUERY':
      // Stale-while-revalidate: preserve previous stats and histograms.
      // Consumers show stale D with a loading indicator until fresh arrives via QUERY_DATA.
      return {
        ...state,
        isQuerying: true,
        queryError: null,
      };

    case 'QUERY_DATA': {
      const { done, ...snapshotData } = signal.payload;
      return {
        ...state,
        snapshot: { ...state.snapshot, ...snapshotData },
        ...(done ? { isQuerying: false, queryError: null } : {}),
      };
    }

    case 'QUERY_ERROR':
      if (state.phase !== 'ready' && state.phase !== 'ready_background_work') return state;
      return { ...state, isQuerying: false, queryError: signal.payload };
  }
}

// ── Numeric type detection ────────────────────────────────

const NUMERIC_TYPES = new Set([
  'TINYINT',
  'SMALLINT',
  'INTEGER',
  'BIGINT',
  'HUGEINT',
  'UTINYINT',
  'USMALLINT',
  'UINTEGER',
  'UBIGINT',
  'FLOAT',
  'DOUBLE',
  'DECIMAL',
]);

export function isNumericType(type: string | null | undefined): boolean {
  if (!type) return false;
  const base = type
    .replace(/\(.+\)/, '')
    .trim()
    .toUpperCase();
  return NUMERIC_TYPES.has(base);
}

/** Columns with <= DROPDOWN_MAX distinct values get a dropdown selector */
export const DROPDOWN_MAX = 50;

// ── STRUCT expansion ──────────────────────────────────────

function parseStructFields(structType: string): { name: string; type: string }[] {
  const inner = structType.match(/^STRUCT\((.+)\)$/s)?.[1];
  if (!inner) return [];
  const fields: { name: string; type: string }[] = [];
  let depth = 0,
    start = 0;
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
function expandColumns(rawCols: ColumnInfo[]): ColumnInfo[] {
  const result: ColumnInfo[] = [];
  for (const c of rawCols) {
    const colType = c.type || 'VARCHAR';
    if (colType.startsWith('STRUCT(')) {
      for (const f of parseStructFields(colType)) {
        result.push({ name: `${c.name}.${f.name}`, type: f.type });
      }
    } else {
      result.push({ name: c.name, type: colType });
    }
  }
  return result;
}

// ── Server query (Arrow IPC streaming transport) ─────────

import { tableFromIPC, type Table as ArrowTable } from 'apache-arrow';

interface ServerQueryResult {
  viewportTable: ArrowTable | null;
  filteredCount: number;
  constrainedStats: Record<string, { min: number; max: number }>;
  dynamicHistograms: Record<string, number[]>;
}

/** Callbacks fired as each Arrow frame arrives over the wire. */
interface StreamCallbacks {
  onGod?: (god: {
    filteredCount: number;
    constrainedStats: Record<string, { min: number; max: number }>;
  }) => void;
  onViewport?: (table: ArrowTable) => void;
}

// ── Arrow frame parsers ──────────────────────────────────

function parseGodTable(godTable: ArrowTable): {
  filteredCount: number;
  constrainedStats: Record<string, { min: number; max: number }>;
} {
  const filteredCount = Number(godTable.getChild('total_rows')?.get(0) ?? 0);
  const constrainedStats: Record<string, { min: number; max: number }> = {};

  for (const field of godTable.schema.fields) {
    const match = field.name.match(/^"?(.+?)_min"?$/);
    if (match) {
      const colName = match[1];
      const minVal = godTable.getChild(field.name)?.get(0);
      const maxFieldName = field.name.replace(/_min"?$/, '_max"');
      const altMaxName = field.name.replace(/_min$/, '_max');
      const maxVal =
        godTable.getChild(maxFieldName)?.get(0) ?? godTable.getChild(altMaxName)?.get(0);
      if (minVal != null && maxVal != null) {
        constrainedStats[colName] = { min: Number(minVal), max: Number(maxVal) };
      }
    }
  }

  return { filteredCount, constrainedStats };
}

function parseHistTable(histTable: ArrowTable): number[] {
  const cntVec = histTable.getChild('cnt');
  if (!cntVec) return new Array(64).fill(0);
  const bins = new Array<number>(cntVec.length);
  for (let i = 0; i < cntVec.length; i++) {
    bins[i] = Number(cntVec.get(i) ?? 0);
  }
  return bins;
}

// ── Streaming frame decoder ──────────────────────────────
//
// Reads the binary framing incrementally from a ReadableStream.
// Yields each Arrow table the instant its bytes are complete —
// no buffering the full response.
//
// Wire format:
//   [4B LE: num_tables]
//   For each table: [4B LE: byte_length] [byte_length bytes: Arrow IPC]
//   Table order: god, viewport, hist_0, hist_1, ...

async function* streamArrowFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ index: number; table: ArrowTable | null }> {
  const reader = body.getReader();
  let buf = new Uint8Array(0);

  async function fill(needed: number) {
    while (buf.length < needed) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Unexpected end of Arrow stream');
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
    }
  }

  function consume(n: number): Uint8Array {
    const slice = buf.slice(0, n);
    buf = buf.slice(n);
    return slice;
  }

  function readU32(): number {
    const bytes = consume(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }

  await fill(4);
  const numTables = readU32();

  for (let i = 0; i < numTables; i++) {
    await fill(4);
    const len = readU32();

    if (len === 0) {
      yield { index: i, table: null };
      continue;
    }

    await fill(len);
    const payload = consume(len);
    yield { index: i, table: tableFromIPC(payload) };
  }

  reader.releaseLock();
}

/**
 * Query the server and decode Arrow IPC frames.
 *
 * When `callbacks` is provided, `onGod` fires the instant the God Query
 * frame arrives (before viewport or histograms). `onViewport` fires when
 * rows are ready. This lets the UI update incrementally while histograms
 * are still in flight.
 */
async function serverQuery(
  fileId: string,
  filters: FilterSpec[],
  sort: SortSpec[],
  offset: number,
  limit: number,
  signal?: AbortSignal,
  callbacks?: StreamCallbacks,
): Promise<ServerQueryResult> {
  const res = await apiFetch(`/api/files/${fileId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters, sort, offset, limit }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Query failed' }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  const histColHeader = res.headers.get('X-Hist-Columns') ?? '';
  const histColNames = histColHeader ? histColHeader.split(',') : [];

  let filteredCount = 0;
  let constrainedStats: Record<string, { min: number; max: number }> = {};
  let viewportTable: ArrowTable | null = null;
  const dynamicHistograms: Record<string, number[]> = {};

  let histIndex = 0;

  for await (const { index, table } of streamArrowFrames(res.body!)) {
    if (!table) continue;

    if (index === 0) {
      // God Query — count + constrained stats
      const god = parseGodTable(table);
      filteredCount = god.filteredCount;
      constrainedStats = god.constrainedStats;
      callbacks?.onGod?.(god);
    } else if (index === 1) {
      // Viewport — keep the raw Arrow table, no materialization
      viewportTable = table;
      callbacks?.onViewport?.(table);
    } else {
      // Histogram frame
      if (histIndex < histColNames.length) {
        dynamicHistograms[histColNames[histIndex]] = parseHistTable(table);
      }
      histIndex++;
    }
  }

  return { viewportTable, filteredCount, constrainedStats, dynamicHistograms };
}

// ── Constants ────────────────────────────────────────────

/** Rows per fetch window — shared between applyFilters and VirtualRows */
export const WINDOW_SIZE = 200;

// ── Hook ─────────────────────────────────────────────────

export function useFileQuery(
  fileId: string,
  activeFilterSpecs?: FilterSpec[],
  sortSpecs?: SortSpec[],
) {
  const { getValidFileProfile, setFileProfile } = useAppStore();

  // ── Synchronous Zustand read — before first render ──
  const cachedEntry = getValidFileProfile(fileId);
  const cachedProfile = cachedEntry?.dataProfile ?? null;
  const cachedCols = cachedProfile?.schema?.length
    ? expandColumns(cachedProfile.schema.map((c) => ({ name: c.name, type: c.type || 'VARCHAR' })))
    : null;

  // ── Query reducer ──
  const initialSnapshot: QuerySnapshot = {
    count: cachedProfile?.rowCount ?? 0,
    total: cachedProfile?.rowCount ?? 0,
    stats: {},
    histograms: {},
  };
  const initialState: QueryState = cachedEntry?.parquetUrl
    ? { activeStep: 4, phase: 'ready_background_work', error: null, queryError: null, isQuerying: false, snapshot: initialSnapshot }
    : { activeStep: 0, phase: 'idle', error: null, queryError: null, isQuerying: false, snapshot: initialSnapshot };
  const [state, dispatch] = useReducer(queryReducer, initialState);

  // Data state
  const [columns, setColumns] = useState<ColumnInfo[]>(cachedCols ?? []);
  const [baseProfile, setBaseProfile] = useState<DataProfile | null>(cachedProfile);
  const [cacheGen, setCacheGen] = useState(0);
  const fetchingCountRef = useRef(0);
  const [isFetchingRange, setIsFetchingRange] = useState(false);

  // ── Stable identity keys for the Basin ──
  const filterKey = JSON.stringify(activeFilterSpecs ?? []);
  const sortKey = JSON.stringify(sortSpecs ?? []);

  // Arrow table cache: window offset → raw Arrow Table (zero-copy from IPC)
  const arrowCache = useRef<Map<number, ArrowTable>>(new Map());
  // Fallback for JSON-seeded initialRows (cleared on first Arrow query)
  const fallbackRows = useRef<Map<number, Record<string, unknown>>>(new Map());
  const isCacheSeeded = useRef(false);

  // Seed fallback from Zustand on Frame 1
  if (!isCacheSeeded.current) {
    if (cachedProfile?.initialRows?.length) {
      for (let i = 0; i < cachedProfile.initialRows.length; i++) {
        fallbackRows.current.set(i, cachedProfile.initialRows[i]);
      }
    }
    isCacheSeeded.current = true;
  }

  // Current filter/sort state
  const filtersRef = useRef<FilterSpec[]>([]);
  const sortRef = useRef<SortSpec[]>([]);

  // AbortController for cancelling stale requests
  const abortRef = useRef<AbortController | null>(null);

  // ── Profile ready = server ready (no WASM boot needed) ──
  const serverReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    function hydrateProfile(profile: DataProfile) {
      setBaseProfile(profile);
      if (profile.schema?.length) {
        const cols = expandColumns(profile.schema.map((c) => ({ name: c.name, type: c.type })));
        setColumns(cols);
        dispatch({ type: 'QUERY_DATA', payload: { count: profile.rowCount, total: profile.rowCount } });
      }
    }

    // ── Fast path: Zustand has profile ──
    if (cachedEntry?.parquetUrl && cachedProfile) {
      serverReadyRef.current = true;
      dispatch({ type: 'SERVER_READY' });
      // The Basin fires the initial query when it sees status === 'ready'

      return () => {
        cancelled = true;
        abortRef.current?.abort();
        arrowCache.current.clear();
        fallbackRows.current.clear();
      };
    }

    // ── Slow path: poll for parquet readiness ──
    async function poll() {
      dispatch({ type: 'START_POLL' });
      try {
        const res = await apiFetch(`/api/files/${fileId}/parquet-url`);
        const data = await res.json();

        if (cancelled) return;

        if (data.status === 'ready') {
          const serverProfile: DataProfile | null = data.dataProfile ?? null;

          if (serverProfile) {
            hydrateProfile(serverProfile);
          }

          // Seed fallback from initialRows (JSON) — replaced on first Arrow query
          const serverRows = serverProfile?.initialRows ?? null;
          if (serverRows?.length) {
            fallbackRows.current.clear();
            for (let i = 0; i < serverRows.length; i++) {
              fallbackRows.current.set(i, serverRows[i]);
            }
            const total = serverProfile?.rowCount ?? serverRows.length;
            dispatch({ type: 'QUERY_DATA', payload: { count: total, total } });
            dispatch({ type: 'PREFLIGHT_DATA_READY' });
          }

          // Resolve relative URLs
          const parquetUrl = data.url.startsWith('/')
            ? `${window.location.origin}${data.url}`
            : data.url;

          setFileProfile(fileId, {
            dataProfile: serverProfile ?? cachedProfile ?? { schema: [], rowCount: 0 },
            parquetUrl,
            cachedAt: Date.now(),
          });

          // Server query endpoint is ready — transition to ready
          serverReadyRef.current = true;
          dispatch({ type: 'SERVER_READY' });
          // The Basin fires the initial query when it sees status === 'ready'
        } else if (data.status === 'converting') {
          pollTimer = setTimeout(poll, 2000);
        } else if (data.status === 'failed') {
          dispatch({ type: 'CONVERSION_FAILED' });
        } else {
          dispatch({ type: 'UNAVAILABLE' });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: 'FATAL_ERROR',
            payload: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      abortRef.current?.abort();
      arrowCache.current.clear();
      fallbackRows.current.clear();
    };
  }, [fileId]);

  // ── Direct Arrow accessors ──────────────────────────────
  // The UI reads Arrow vectors at paint time — no materialization.
  // BigInt → Number conversion is lazy, only for visible cells.

  const getCell = useCallback((globalIndex: number, colName: string): unknown => {
    // Arrow cache: O(1) lookup per window
    for (const [offset, table] of arrowCache.current) {
      const local = globalIndex - offset;
      if (local >= 0 && local < table.numRows) {
        const val = table.getChild(colName)?.get(local);
        return typeof val === 'bigint' ? Number(val) : val;
      }
    }
    // Fallback: JSON-seeded initialRows (before first Arrow query)
    const row = fallbackRows.current.get(globalIndex);
    return row ? row[colName] : undefined;
  }, []);

  const hasRow = useCallback((globalIndex: number): boolean => {
    for (const [offset, table] of arrowCache.current) {
      const local = globalIndex - offset;
      if (local >= 0 && local < table.numRows) return true;
    }
    return fallbackRows.current.has(globalIndex);
  }, []);

  // ── Fetch a range of rows (stores Arrow table, no return) ─

  const MAX_CACHED_TABLES = 10;

  const fetchRange = useCallback(
    async (offset: number, limit: number, signal?: AbortSignal): Promise<void> => {
      if (!serverReadyRef.current) return;

      // Skip if this window is already cached
      if (arrowCache.current.has(offset)) return;

      fetchingCountRef.current++;
      setIsFetchingRange(true);
      try {
        const result = await serverQuery(
          fileId,
          filtersRef.current,
          sortRef.current,
          offset,
          limit,
          signal,
        );

        if (result.viewportTable) {
          arrowCache.current.set(offset, result.viewportTable);

          // Evict tables far from viewport — keep closest MAX_CACHED_TABLES
          if (arrowCache.current.size > MAX_CACHED_TABLES) {
            const sorted = [...arrowCache.current.keys()].sort(
              (a, b) => Math.abs(a - offset) - Math.abs(b - offset),
            );
            for (let i = MAX_CACHED_TABLES; i < sorted.length; i++) {
              arrowCache.current.delete(sorted[i]);
            }
          }

          setCacheGen((g) => g + 1);
        }
      } catch {
        // Fetch failed — ignore (abort or network error)
      } finally {
        fetchingCountRef.current--;
        if (fetchingCountRef.current === 0) setIsFetchingRange(false);
      }
    },
    [fileId],
  );

  // ── The Basin ────────────────────────────────
  // Watches filter/sort state and auto-queries. No imperative applyFilters.
  // The UI changes the shape of the riverbed; the water conforms.

  useEffect(() => {
    if (state.phase !== 'ready' && state.phase !== 'ready_background_work') return;

    const filters = activeFilterSpecs ?? [];
    const sort = sortSpecs ?? [];

    // Debounce: batch rapid filter changes (drag frames, typing) into one query
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Sync refs for fetchRange (scroll fetches need current filters)
      filtersRef.current = filters;
      sortRef.current = sort;

      // Clear stale data
      arrowCache.current.clear();
      fallbackRows.current.clear();
      setCacheGen((g) => g + 1);

      dispatch({ type: 'START_QUERY' });
      serverQuery(fileId, filters, sort, 0, WINDOW_SIZE, controller.signal, {
        onGod: ({ filteredCount: fc }) => {
          dispatch({ type: 'QUERY_DATA', payload: { count: fc, ...(filters.length === 0 ? { total: fc } : {}) } });
        },
        onViewport: (table) => {
          arrowCache.current.set(0, table);
          setCacheGen((g) => g + 1);
        },
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          dispatch({ type: 'QUERY_DATA', payload: {
            stats: Object.keys(result.constrainedStats).length > 0 ? result.constrainedStats : {},
            histograms: Object.keys(result.dynamicHistograms).length > 0 ? result.dynamicHistograms : {},
            done: true,
          } });
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          console.error('[useFileQuery] filter query error:', err);
          dispatch({ type: 'QUERY_ERROR', payload: err });
        });
    }, 80);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, state.phase, filterKey, sortKey]);

  /** Flush Arrow cache + abort in-flight requests. Call when the table drawer closes. */
  const clearCache = useCallback(() => {
    abortRef.current?.abort();
    arrowCache.current.clear();
    fallbackRows.current.clear();
    setCacheGen((g) => g + 1);
  }, []);

  return {
    lifecycle: { phase: state.phase, isQuerying: state.isQuerying, error: state.error, queryError: state.queryError },
    snapshot: state.snapshot,
    store: { columns, baseProfile, getCell, hasRow, fetchRange, clearCache, isFetchingRange, cacheGen },
  };
}

// ── Hover Prefetch ────────────────────────────────────────

const _prefetching = new Set<string>();

/**
 * Fire-and-forget prefetch of the parquet-url endpoint.
 * Warms Zustand cache (profile + parquetUrl + initialRows).
 */
export function prefetchFileQuery(fileId: string): void {
  const { getValidFileProfile, setFileProfile } = useAppStore.getState();

  if (getValidFileProfile(fileId) || _prefetching.has(fileId)) return;

  _prefetching.add(fileId);

  apiFetch(`/api/files/${fileId}/parquet-url`)
    .then((res) => res.json())
    .then((data) => {
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
    .catch(() => {})
    .finally(() => _prefetching.delete(fileId));
}

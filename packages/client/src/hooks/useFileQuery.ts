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
import { HISTOGRAM_BINS } from '@genome-hub/shared';

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
  stateMatrix: StateMatrix | null;
}

export interface QueryState {
  activeStep: 0 | 1 | 2 | 3 | 4;
  phase: QueryPhase;
  error: string | null;
  queryError: Error | string | null;
  isQuerying: boolean;
  snapshot: QuerySnapshot;
  /** Committed snapshot — only advances when the query fully completes (done: true).
   *  River reads from this so its percentage resolves at the same instant as Ready. */
  settledSnapshot: QuerySnapshot;
  /** The filter+sort key that produced settledSnapshot. Used to derive isPending. */
  settledKey: string;
}

export type QueryAction =
  | { type: 'START_POLL' }
  | { type: 'PREFLIGHT_DATA_READY' }
  | { type: 'SERVER_READY' }
  | { type: 'UNAVAILABLE' }
  | { type: 'CONVERSION_FAILED' }
  | { type: 'FATAL_ERROR'; payload: string }
  | { type: 'START_QUERY' }
  | { type: 'QUERY_DATA'; payload: Partial<QuerySnapshot> & { done?: boolean; settledKey?: string } }
  | { type: 'QUERY_ERROR'; payload: Error | string };

function queryReducer(state: QueryState, signal: QueryAction): QueryState {
  switch (signal.type) {
    case 'START_POLL':
      return state.phase === 'idle'
        ? { activeStep: 0, phase: 'loading', error: null, queryError: null, isQuerying: false, snapshot: state.snapshot, settledSnapshot: state.settledSnapshot, settledKey: state.settledKey }
        : state;

    case 'PREFLIGHT_DATA_READY':
      return { ...state, activeStep: 4, phase: 'ready_background_work', error: null };

    case 'SERVER_READY':
      return { ...state, activeStep: 4, phase: 'ready', error: null };

    case 'UNAVAILABLE':
      return { activeStep: 0, phase: 'unavailable', error: null, queryError: null, isQuerying: false, snapshot: state.snapshot, settledSnapshot: state.settledSnapshot, settledKey: state.settledKey };

    case 'CONVERSION_FAILED':
      return { activeStep: 0, phase: 'failed', error: null, queryError: null, isQuerying: false, snapshot: state.snapshot, settledSnapshot: state.settledSnapshot, settledKey: state.settledKey };

    case 'FATAL_ERROR':
      if (state.phase === 'ready_background_work' || state.phase === 'ready') return state;
      return { ...state, phase: 'error', error: signal.payload, isQuerying: false };

    case 'START_QUERY':
      // Stale-while-revalidate: preserve previous stats and histograms.
      // settledSnapshot frozen — River holds its previous value until done.
      return {
        ...state,
        isQuerying: true,
        queryError: null,
      };

    case 'QUERY_DATA': {
      const { done, settledKey, ...snapshotData } = signal.payload;
      const newSnapshot = { ...state.snapshot, ...snapshotData };
      return {
        ...state,
        snapshot: newSnapshot,
        // settledSnapshot + settledKey advance atomically when query completes (done: true),
        // or on hydration/profile when no active query is running.
        ...(done
          ? { isQuerying: false, queryError: null, settledSnapshot: newSnapshot, settledKey: settledKey ?? state.settledKey }
          : !state.isQuerying
            ? { settledSnapshot: newSnapshot }
            : {}),
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
  stateMatrix: StateMatrix | null;
}

/** Callbacks fired as each Arrow frame arrives over the wire. */
interface StreamCallbacks {
  onGod?: (god: {
    filteredCount: number;
    constrainedStats: Record<string, { min: number; max: number }>;
    dynamicHistograms: Record<string, number[]>;
  }) => void;
  onViewport?: (table: ArrowTable) => void;
}

// ── Arrow frame parsers ──────────────────────────────────

function parseGodTable(
  godTable: ArrowTable,
  histColNames: string[],
): {
  filteredCount: number;
  constrainedStats: Record<string, { min: number; max: number }>;
  dynamicHistograms: Record<string, number[]>;
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

  // Unpack histogram MAP columns: MAP(INT32, UBIGINT) → number[HISTOGRAM_BINS]
  // Defensive getChild: try unquoted, then quoted (DuckDB/Arrow may preserve quotes)
  const dynamicHistograms: Record<string, number[]> = {};
  for (const colName of histColNames) {
    const fieldName = `hist_${colName}`;
    const mapVec = godTable.getChild(fieldName) ?? godTable.getChild(`"${fieldName}"`);
    const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
    if (mapVec) {
      const mapRow = mapVec.get(0);
      if (mapRow) {
        for (const [bucket, count] of mapRow) {
          const idx = Number(bucket);
          if (idx >= 0 && idx < HISTOGRAM_BINS) bins[idx] = Number(count);
        }
      }
    }
    dynamicHistograms[colName] = bins;
  }

  return { filteredCount, constrainedStats, dynamicHistograms };
}

/** State matrix: {filter_state → count} pairs from the bitwise GROUP BY. */
export interface StateMatrix {
  /** Bit position → column name (e.g. bit 0 = "POS", bit 1 = "MAPQ") */
  columns: string[];
  /** Array of {state, count} — state is a bitmask, count is the row count */
  entries: { state: number; count: number }[];
}

/**
 * Derive pairwise correlation strengths from the state matrix.
 *
 * For a grabbed column G (bit index gIdx), compute each other column O's
 * "sensitivity" to G: how much does O's pass-rate change when G flips?
 *
 * sensitivity(G,O) = |P(O=1 | G=1) - P(O=1 | G=0)|
 *
 * Returns values in [0, 1]. Higher = more correlated = should glow brighter.
 */
export function deriveCorrelations(
  matrix: StateMatrix,
  grabbedColumn: string,
): Record<string, number> {
  const gIdx = matrix.columns.indexOf(grabbedColumn);
  if (gIdx < 0) return {};

  const gBit = 1 << gIdx;
  const result: Record<string, number> = {};

  for (let oIdx = 0; oIdx < matrix.columns.length; oIdx++) {
    if (oIdx === gIdx) continue;
    const oBit = 1 << oIdx;

    // Split by G=1 vs G=0, count O=1 in each partition
    let gOnTotal = 0, gOnOPass = 0;
    let gOffTotal = 0, gOffOPass = 0;

    for (const { state, count } of matrix.entries) {
      if (state & gBit) {
        gOnTotal += count;
        if (state & oBit) gOnOPass += count;
      } else {
        gOffTotal += count;
        if (state & oBit) gOffOPass += count;
      }
    }

    const pOGivenGOn = gOnTotal > 0 ? gOnOPass / gOnTotal : 0;
    const pOGivenGOff = gOffTotal > 0 ? gOffOPass / gOffTotal : 0;
    result[matrix.columns[oIdx]] = Math.abs(pOGivenGOn - pOGivenGOff);
  }

  return result;
}

function parseStateMatrix(table: ArrowTable, columns: string[]): StateMatrix {
  const stateVec = table.getChild('filter_state');
  const cntVec = table.getChild('cnt');
  const entries: { state: number; count: number }[] = [];
  if (stateVec && cntVec) {
    for (let i = 0; i < stateVec.length; i++) {
      entries.push({
        state: Number(stateVec.get(i) ?? 0),
        count: Number(cntVec.get(i) ?? 0),
      });
    }
  }
  return { columns, entries };
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
//   Table order: viewport, god (with histogram MAPs), state_matrix?

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
 * When `callbacks` is provided, `onViewport` fires the instant the viewport
 * frame arrives (first frame — rows appear before count). `onGod` fires when
 * the god query completes. This lets the UI show rows while count + stats
 * are still computing.
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
  const stateColHeader = res.headers.get('X-State-Columns') ?? '';
  const stateColNames = stateColHeader ? stateColHeader.split(',') : [];
  const hasStateMatrix = stateColNames.length >= 2;

  let filteredCount = 0;
  let constrainedStats: Record<string, { min: number; max: number }> = {};
  let viewportTable: ArrowTable | null = null;
  let dynamicHistograms: Record<string, number[]> = {};
  let stateMatrix: StateMatrix | null = null;

  // Table indices: 0=viewport, 1=god (with histogram MAPs), 2=state matrix (if present)
  for await (const { index, table } of streamArrowFrames(res.body!)) {
    if (!table) continue;

    if (index === 0) {
      viewportTable = table;
      callbacks?.onViewport?.(table);
    } else if (index === 1) {
      const god = parseGodTable(table, histColNames);
      filteredCount = god.filteredCount;
      constrainedStats = god.constrainedStats;
      dynamicHistograms = god.dynamicHistograms;
      callbacks?.onGod?.(god);
    } else if (index === 2 && hasStateMatrix) {
      stateMatrix = parseStateMatrix(table, stateColNames);
    }
  }

  return { viewportTable, filteredCount, constrainedStats, dynamicHistograms, stateMatrix };
}

// ── Constants ────────────────────────────────────────────

/** Rows per fetch window — shared between applyFilters and VirtualRows */
export const WINDOW_SIZE = 200;

// ── Hook ─────────────────────────────────────────────────

export function useFileQuery(
  fileId: string,
  activeFilterSpecs?: FilterSpec[],
  sortSpecs?: SortSpec[],
  enablePreflight = false,
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
    stateMatrix: null,
  };
  // ── Stable identity keys for the Basin ──
  const filterKey = JSON.stringify(activeFilterSpecs ?? []);
  const sortKey = JSON.stringify(sortSpecs ?? []);
  const currentKey = filterKey + sortKey;

  const initialState: QueryState = cachedEntry?.parquetUrl
    ? { activeStep: 4, phase: 'ready_background_work', error: null, queryError: null, isQuerying: false, snapshot: initialSnapshot, settledSnapshot: initialSnapshot, settledKey: currentKey }
    : { activeStep: 0, phase: 'idle', error: null, queryError: null, isQuerying: false, snapshot: initialSnapshot, settledSnapshot: initialSnapshot, settledKey: currentKey };
  const [state, dispatch] = useReducer(queryReducer, initialState);

  // Data state
  const [columns, setColumns] = useState<ColumnInfo[]>(cachedCols ?? []);
  const [baseProfile, setBaseProfile] = useState<DataProfile | null>(cachedProfile);
  const [cacheGen, setCacheGen] = useState(0);
  const fetchingCountRef = useRef(0);
  const [isFetchingRange, setIsFetchingRange] = useState(false);

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
  // Preflight: speculative god-only query fired immediately (0ms) before the debounced full query
  const preflightRef = useRef<{ abort: AbortController; filterKey: string } | null>(null);

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
    const currentFilterKey = JSON.stringify(filters);

    // ── Debounced query: 200ms ─────────────────────────────────────────
    // Don't abort the in-flight query immediately — let it run during the
    // debounce window. If it finishes before the timer fires, the user gets
    // results faster. Only abort when we're actually ready to fire the new one.

    const timer = setTimeout(() => {
      // NOW abort stale queries — the user has stopped moving for 200ms
      preflightRef.current?.abort.abort();
      preflightRef.current = null;
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

      // ── Preflight: god query only (count + stats, no rows/histograms) ──
      if (enablePreflight) {
        const pfAbort = new AbortController();
        preflightRef.current = { abort: pfAbort, filterKey: currentFilterKey };

        apiFetch(`/api/files/${fileId}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters, sort, offset: 0, limit: 0, mode: 'preflight' }),
          signal: pfAbort.signal,
        })
          .then((res) => {
            if (!res.ok || !res.body) return null;
            return streamArrowFrames(res.body);
          })
          .then(async (frames) => {
            if (!frames) return;
            for await (const { table } of frames) {
              if (!table) continue;
              const god = parseGodTable(table, []);
              if (preflightRef.current?.filterKey === currentFilterKey) {
                dispatch({ type: 'QUERY_DATA', payload: {
                  count: god.filteredCount,
                  stats: Object.keys(god.constrainedStats).length > 0 ? god.constrainedStats : {},
                  ...(filters.length === 0 ? { total: god.filteredCount } : {}),
                } });
              }
            }
          })
          .catch(() => {});
      }

      // ── Full query ────────────────────────────────────────────────────
      dispatch({ type: 'START_QUERY' });
      serverQuery(fileId, filters, sort, 0, WINDOW_SIZE, controller.signal, {
        onGod: ({ filteredCount: fc }) => {
          // Cancel preflight — full query supersedes
          preflightRef.current?.abort.abort();
          preflightRef.current = null;
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
            stateMatrix: result.stateMatrix,
            done: true,
            settledKey: currentKey,
          } });
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          console.error('[useFileQuery] filter query error:', err);
          dispatch({ type: 'QUERY_ERROR', payload: err });
        });
    }, 200);

    return () => {
      clearTimeout(timer);
      // New input arrived — kill everything from the previous cycle.
      // The 200ms debounce restarts; no stale queries survive.
      preflightRef.current?.abort.abort();
      preflightRef.current = null;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, state.phase, filterKey, sortKey, enablePreflight]);

  /** Flush Arrow cache + abort in-flight requests. Call when the table drawer closes. */
  const clearCache = useCallback(() => {
    abortRef.current?.abort();
    arrowCache.current.clear();
    fallbackRows.current.clear();
    setCacheGen((g) => g + 1);
  }, []);

  // isPending: true from the instant filters change until the matching query settles.
  // Three states covered: debouncing (timer running), querying (in-flight), aborted (stale stats).
  // All in the reducer — one atomic state transition on QUERY_DATA { done, settledKey }.
  const isPending = state.isQuerying || currentKey !== state.settledKey;

  return {
    lifecycle: { phase: state.phase, isQuerying: state.isQuerying, isPending, error: state.error, queryError: state.queryError },
    snapshot: state.snapshot,
    settledSnapshot: state.settledSnapshot,
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

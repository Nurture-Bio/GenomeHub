/**
 * useParquetPreview — Thin Glass state machine over the server-side query endpoint.
 *
 * All DuckDB computation happens server-side via POST /api/files/:id/query.
 * The hook manages UI state (filters, sort, pagination) and synchronizes
 * with the server. Slider drags are debounced; stale responses are discarded
 * via AbortController.
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

// ── Pipeline State Machine ───────────────────────────────

export type PipelineStatus =
  | 'idle'
  | 'loading'
  | 'ready_background_work'  // data visible, server still hydrating profile
  | 'ready'                  // fully operational
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
  | { type: 'SERVER_READY' }
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
      return { activeStep: 4, status: 'ready_background_work', error: null };

    case 'SERVER_READY':
      return { activeStep: 4, status: 'ready', error: null };

    case 'UNAVAILABLE':
      return { activeStep: 0, status: 'unavailable', error: null };

    case 'CONVERSION_FAILED':
      return { activeStep: 0, status: 'failed', error: null };

    case 'FATAL_ERROR':
      if (state.status === 'ready_background_work' || state.status === 'ready') return state;
      return { ...state, status: 'error', error: signal.payload };
  }
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

/** Columns with <= DROPDOWN_MAX distinct values get a dropdown selector */
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
  rows: Record<string, unknown>[];
  filteredCount: number;
  constrainedStats: Record<string, { min: number; max: number }>;
  dynamicHistograms: Record<string, number[]>;
}

/** Callbacks fired as each Arrow frame arrives over the wire. */
interface StreamCallbacks {
  onGod?: (god: { filteredCount: number; constrainedStats: Record<string, { min: number; max: number }> }) => void;
  onViewport?: (rows: Record<string, unknown>[]) => void;
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
      const maxVal = godTable.getChild(maxFieldName)?.get(0)
                  ?? godTable.getChild(altMaxName)?.get(0);
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
  return Array.from(cntVec.toArray());
}

function arrowTableToRows(table: ArrowTable): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const colNames = table.schema.fields.map(f => f.name);

  for (let i = 0; i < table.numRows; i++) {
    const row: Record<string, unknown> = {};
    for (const name of colNames) {
      const val = table.getChild(name)?.get(i);
      row[name] = typeof val === 'bigint' ? Number(val) : val;
    }
    rows.push(row);
  }
  return rows;
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
  let rows: Record<string, unknown>[] = [];
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
      // Viewport rows
      rows = arrowTableToRows(table);
      callbacks?.onViewport?.(rows);
    } else {
      // Histogram frame
      if (histIndex < histColNames.length) {
        dynamicHistograms[histColNames[histIndex]] = parseHistTable(table);
      }
      histIndex++;
    }
  }

  return { rows, filteredCount, constrainedStats, dynamicHistograms };
}

// ── Hook ─────────────────────────────────────────────────

export function useParquetPreview(fileId: string) {
  const { getValidFileProfile, setFileProfile } = useAppStore();

  // ── Synchronous Zustand read — before first render ──
  const cachedEntry = getValidFileProfile(fileId);
  const cachedProfile = cachedEntry?.dataProfile ?? null;
  const cachedCols = cachedProfile?.schema?.length
    ? expandColumns(cachedProfile.schema.map(c => ({ name: c.name, type: c.type || 'VARCHAR' })))
    : null;

  // ── Pipeline reducer ──
  const initialPipeline: PipelineState = cachedEntry?.parquetUrl
    ? { activeStep: 4, status: 'ready_background_work', error: null }
    : { activeStep: 0, status: 'idle', error: null };
  const [pipeline, dispatch] = useReducer(pipelineReducer, initialPipeline);

  // Data state
  const [columns,       setColumns]       = useState<ColumnInfo[]>(cachedCols ?? []);
  const [totalRows,     setTotalRows]     = useState(cachedProfile?.rowCount ?? 0);
  const filteredCountRef = useRef(cachedProfile?.rowCount ?? 0);
  const [filteredCount, _setFilteredCount] = useState(cachedProfile?.rowCount ?? 0);
  const setFilteredCount = useCallback((v: number) => {
    filteredCountRef.current = v;
    _setFilteredCount(v);
  }, []);
  const [baseProfile,   setBaseProfile]   = useState<DataProfile | null>(cachedProfile);
  const [isQuerying,    setIsQuerying]    = useState(false);
  const [cacheGen,      setCacheGen]      = useState(0);

  // Row cache: offset → row data
  const rowCache = useRef<Map<number, Record<string, unknown>>>(new Map());
  const isCacheSeeded = useRef(false);

  // Seed from Zustand on Frame 1
  if (!isCacheSeeded.current) {
    if (cachedProfile?.initialRows?.length) {
      for (let i = 0; i < cachedProfile.initialRows.length; i++) {
        rowCache.current.set(i, cachedProfile.initialRows[i]);
      }
    }
    isCacheSeeded.current = true;
  }

  // Current filter/sort state for fetchWindow
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
        const cols = expandColumns(profile.schema.map(c => ({ name: c.name, type: c.type })));
        setColumns(cols);
        setTotalRows(profile.rowCount);
        setFilteredCount(profile.rowCount);
      }
    }

    // ── Fast path: Zustand has profile ──
    if (cachedEntry?.parquetUrl && cachedProfile) {
      // We have data already — fire initial server query to populate
      serverReadyRef.current = true;
      dispatch({ type: 'SERVER_READY' });

      // Fire an initial query to get live rows
      serverQuery(fileId, [], [], 0, 100)
        .then(result => {
          if (cancelled) return;
          rowCache.current.clear();
          for (let i = 0; i < result.rows.length; i++) {
            rowCache.current.set(i, result.rows[i]);
          }
          setFilteredCount(result.filteredCount);
          setTotalRows(result.filteredCount);
          setCacheGen(g => g + 1);
        })
        .catch(() => {}); // non-fatal — preflight data is already visible

      return () => { cancelled = true; };
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

          // Seed cache from initialRows
          const serverRows = serverProfile?.initialRows ?? null;
          if (serverRows?.length) {
            rowCache.current.clear();
            for (let i = 0; i < serverRows.length; i++) {
              rowCache.current.set(i, serverRows[i]);
            }
            const total = serverProfile?.rowCount ?? serverRows.length;
            setTotalRows(total);
            setFilteredCount(total);
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

          // Fire initial query to populate live rows
          serverQuery(fileId, [], [], 0, 100)
            .then(result => {
              if (cancelled) return;
              rowCache.current.clear();
              for (let i = 0; i < result.rows.length; i++) {
                rowCache.current.set(i, result.rows[i]);
              }
              setFilteredCount(result.filteredCount);
              setTotalRows(result.filteredCount);
              setCacheGen(g => g + 1);
            })
            .catch(() => {}); // non-fatal

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
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> => {
    if (!serverReadyRef.current) return [];

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

    try {
      const result = await serverQuery(
        fileId,
        filtersRef.current,
        sortRef.current,
        offset,
        limit,
        signal,
      );

      for (let i = 0; i < result.rows.length; i++) {
        rowCache.current.set(offset + i, result.rows[i]);
      }

      return result.rows;
    } catch {
      return [];
    }
  }, [fileId]);

  // ── Apply filters ───────────────────────────────────────

  const applyFilters = useCallback(async (
    filters: FilterSpec[],
    sort: SortSpec[],
    _globalStats?: Record<string, ColumnStats>,
  ): Promise<{
    filteredCount: number;
    constrainedStats?: Record<string, ColumnStats>;
    constrainedHistograms?: Record<string, number[]>;
  }> => {
    if (!serverReadyRef.current) return { filteredCount: 0 };

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsQuerying(true);
    try {
      filtersRef.current = filters;
      sortRef.current = sort;
      rowCache.current.clear();
      setCacheGen(g => g + 1);

      const result = await serverQuery(fileId, filters, sort, 0, 100, controller.signal, {
        // God Query lands first — update count before rows arrive
        onGod: ({ filteredCount: fc }) => setFilteredCount(fc),
        // Viewport lands second — seed cache before histograms arrive
        onViewport: (viewportRows) => {
          rowCache.current.clear();
          for (let i = 0; i < viewportRows.length; i++) {
            rowCache.current.set(i, viewportRows[i]);
          }
          setCacheGen(g => g + 1);
        },
      });

      // Map server constrainedStats → ColumnStats
      const constrainedStats: Record<string, ColumnStats> | undefined =
        Object.keys(result.constrainedStats).length > 0
          ? result.constrainedStats
          : undefined;

      const constrainedHistograms: Record<string, number[]> | undefined =
        Object.keys(result.dynamicHistograms).length > 0
          ? result.dynamicHistograms
          : undefined;

      return { filteredCount: result.filteredCount, constrainedStats, constrainedHistograms };
    } catch (err) {
      // Aborted requests are not errors — return last known count
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { filteredCount: filteredCountRef.current };
      }
      setIsQuerying(false);
      throw err;
    }
    setIsQuerying(false);
  }, [fileId]);

  /** Synchronous snapshot of the warm rowCache. */
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

const _prefetching = new Set<string>();

/**
 * Fire-and-forget prefetch of the parquet-url endpoint.
 * Warms Zustand cache (profile + parquetUrl + initialRows).
 */
export function prefetchParquetUrl(fileId: string): void {
  const { getValidFileProfile, setFileProfile } = useAppStore.getState();

  if (getValidFileProfile(fileId) || _prefetching.has(fileId)) return;

  _prefetching.add(fileId);

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
    .catch(() => {})
    .finally(() => _prefetching.delete(fileId));
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  computeStrandMap,
  initStrandHeader,
  StrandView,
  type RecordCursor,
} from '@strand/core';
import {
  SCHEMA,
  INTERN_TABLE,
  COLUMNS,
  type StrandColumnMeta,
} from '../strand/schema';
import { isNumericType, DROPDOWN_MAX } from './useJsonDuckDb';
import type { ColumnStats, ColumnCardinality, SortSpec } from './useJsonDuckDb';

// ── Types ────────────────────────────────────────────────

export type StrandTableStatus = 'init' | 'streaming' | 'ready' | 'error';

export interface UseStrandTableResult {
  status:            StrandTableStatus;
  totalRecords:      number;
  filteredCount:     number;
  columns:           StrandColumnMeta[];
  columnStats:       Record<string, ColumnStats>;
  columnCardinality: Record<string, ColumnCardinality>;
  filteredIndices:   number[];
  cursor:            RecordCursor | null;
  filters:           Record<string, string>;
  sort:              SortSpec | null;
  onFilterChange:    (path: string, value: string) => void;
  onSortChange:      (sort: SortSpec | null) => void;
  error:             string | null;
}

// ── Constants ────────────────────────────────────────────

const RECORD_COUNT = 50_000;
const BATCH_SIZE   = 500;
const INDEX_CAP    = 65_536;  // power of 2, ≥ RECORD_COUNT
const HEAP_CAP     = 4 * 1024 * 1024;  // ~4MB for variable-length strings

// ── Field reading helper ─────────────────────────────────

export function readField(cursor: RecordCursor, col: StrandColumnMeta): unknown {
  switch (col.strandType) {
    case 'i32':      return cursor.getI32(col.field);
    case 'f64':      return cursor.getF64(col.field);
    case 'utf8':     return cursor.getString(col.field);
    case 'utf8_ref': return cursor.getRef(col.field);
    default:         return cursor.get(col.field);
  }
}

// ── Compare values for sorting ───────────────────────────

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

// ── Pre-parsed filter descriptor (avoids regex per record) ─

type ParsedFilter =
  | { col: StrandColumnMeta; type: 'between'; lo: number; hi: number }
  | { col: StrandColumnMeta; type: 'exact'; value: string }
  | { col: StrandColumnMeta; type: 'search'; needle: string };

// ── Progressive stats accumulator ────────────────────────

const NUM_COLS = COLUMNS.filter(c => isNumericType(c.duckType));
const STR_COLS = COLUMNS.filter(c => !isNumericType(c.duckType));

interface StatsAccum {
  stats:        Record<string, { min: number; max: number }>;
  cardSets:     Record<string, Set<string>>;
  cardOverflow: Record<string, boolean>;
  scannedUpTo:  number;
}

function createAccum(): StatsAccum {
  const stats: Record<string, { min: number; max: number }> = {};
  const cardSets: Record<string, Set<string>> = {};
  const cardOverflow: Record<string, boolean> = {};
  for (const col of NUM_COLS) stats[col.path] = { min: Infinity, max: -Infinity };
  for (const col of STR_COLS) { cardSets[col.path] = new Set(); cardOverflow[col.path] = false; }
  return { stats, cardSets, cardOverflow, scannedUpTo: 0 };
}

function scanRange(accum: StatsAccum, cursor: RecordCursor, from: number, to: number) {
  for (let seq = from; seq < to; seq++) {
    cursor.seek(seq);
    for (const col of NUM_COLS) {
      const v = Number(readField(cursor, col));
      if (!isNaN(v)) {
        const s = accum.stats[col.path];
        if (v < s.min) s.min = v;
        if (v > s.max) s.max = v;
      }
    }
    for (const col of STR_COLS) {
      if (accum.cardOverflow[col.path]) continue;
      const v = String(readField(cursor, col) ?? '');
      accum.cardSets[col.path].add(v);
      if (accum.cardSets[col.path].size > DROPDOWN_MAX) accum.cardOverflow[col.path] = true;
    }
  }
  accum.scannedUpTo = to;
}

function snapshotStats(accum: StatsAccum): Record<string, ColumnStats> {
  const out: Record<string, ColumnStats> = {};
  for (const key of Object.keys(accum.stats)) {
    const s = accum.stats[key];
    if (s.min !== Infinity) out[key] = { min: s.min, max: s.max };
  }
  return out;
}

function snapshotCardinality(accum: StatsAccum): Record<string, ColumnCardinality> {
  const out: Record<string, ColumnCardinality> = {};
  for (const col of STR_COLS) {
    const set = accum.cardSets[col.path];
    const overflow = accum.cardOverflow[col.path];
    out[col.path] = {
      distinct: overflow ? DROPDOWN_MAX + 1 : set.size,
      values: overflow ? [] : [...set].sort(),
    };
  }
  return out;
}

// ── Hook ─────────────────────────────────────────────────

export function useStrandTable(): UseStrandTableResult {
  const [status, setStatus]                     = useState<StrandTableStatus>('init');
  const [totalRecords, setTotalRecords]         = useState(0);
  const [columnStats, setColumnStats]           = useState<Record<string, ColumnStats>>({});
  const [columnCardinality, setColumnCardinality] = useState<Record<string, ColumnCardinality>>({});
  const [error, setError]                       = useState<string | null>(null);
  const [filters, setFilters]                   = useState<Record<string, string>>({});
  const [debouncedFilters, setDebouncedFilters] = useState<Record<string, string>>({});
  const [sort, setSort]                         = useState<SortSpec | null>(null);

  const viewRef   = useRef<StrandView | null>(null);
  const cursorRef = useRef<RecordCursor | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initialize SAB + worker, drain incrementally ─────

  useEffect(() => {
    if (!crossOriginIsolated) {
      setError('SharedArrayBuffer requires cross-origin isolation (COOP/COEP headers)');
      setStatus('error');
      return;
    }

    const map = computeStrandMap({
      schema: SCHEMA,
      index_capacity: INDEX_CAP,
      heap_capacity: HEAP_CAP,
      query: { assembly: 'mock', chrom: '*', start: 0, end: 0 },
      estimated_records: RECORD_COUNT,
    });

    const sab = new SharedArrayBuffer(map.total_bytes);
    initStrandHeader(sab, map);

    const view = new StrandView(sab, INTERN_TABLE);
    const cursor = view.allocateCursor();
    viewRef.current = view;
    cursorRef.current = cursor;

    setStatus('streaming');

    const worker = new Worker(
      new URL('../workers/strandMockWorker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.postMessage({
      type: 'init',
      sab,
      recordCount: RECORD_COUNT,
      batchSize: BATCH_SIZE,
    });

    let cancelled = false;
    const accum = createAccum();

    async function drain() {
      let after = 0;

      while (!cancelled) {
        const count = await view.waitForCommit(after, 2000);
        if (cancelled) return;

        if (count > after) {
          // Scan newly committed records for stats/cardinality
          scanRange(accum, cursor, after, count);
          after = count;

          // Push incremental updates to React
          setTotalRecords(count);
          setColumnStats(snapshotStats(accum));
          setColumnCardinality(snapshotCardinality(accum));
        }

        const st = view.status;
        if (st === 'eos' || st === 'error') {
          setStatus(st === 'error' ? 'error' : 'ready');
          return;
        }
      }
    }

    drain();

    worker.onmessage = (msg) => {
      if (msg.data.type === 'error') {
        setError(msg.data.message);
        setStatus('error');
      }
    };

    return () => {
      cancelled = true;
      worker.terminate();
      viewRef.current = null;
      cursorRef.current = null;
    };
  }, []);

  // ── Filter change (debounced) ────────────────────────

  const onFilterChange = useCallback((path: string, value: string) => {
    setFilters(prev => ({ ...prev, [path]: value }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedFilters(prev => ({ ...prev, [path]: value }));
    }, 150);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // ── Sort change ──────────────────────────────────────

  const onSortChange = useCallback((s: SortSpec | null) => {
    setSort(s);
  }, []);

  // ── Compute filtered + sorted indices ────────────────

  const filteredIndices = useMemo(() => {
    const cursor = cursorRef.current;
    if (!cursor || totalRecords === 0) return [];

    const activeFilters = Object.entries(debouncedFilters).filter(([, v]) => v.trim());

    // Pre-parse all filters once
    const parsed: ParsedFilter[] = [];
    for (const [path, raw] of activeFilters) {
      const col = COLUMNS.find(c => c.path === path);
      if (!col) continue;
      const trimmed = raw.trim();
      const bm = trimmed.match(/^BETWEEN\s+([\d.e+-]+)\s+AND\s+([\d.e+-]+)$/i);
      if (bm) { parsed.push({ col, type: 'between', lo: Number(bm[1]), hi: Number(bm[2]) }); continue; }
      const em = trimmed.match(/^= '(.+)'$/);
      if (em) { parsed.push({ col, type: 'exact', value: em[1] }); continue; }
      if (!isNumericType(col.duckType)) { parsed.push({ col, type: 'search', needle: trimmed.toLowerCase() }); }
    }

    // No filters → return all indices (fast path)
    if (parsed.length === 0 && !sort) {
      return Array.from({ length: totalRecords }, (_, i) => i);
    }

    // Scan all records
    const indices: number[] = [];
    if (parsed.length === 0) {
      for (let i = 0; i < totalRecords; i++) indices.push(i);
    } else {
      for (let seq = 0; seq < totalRecords; seq++) {
        cursor.seek(seq);
        let pass = true;
        for (const f of parsed) {
          if (f.type === 'between') {
            const v = Number(readField(cursor, f.col));
            if (v < f.lo || v > f.hi) { pass = false; break; }
          } else if (f.type === 'exact') {
            if (String(readField(cursor, f.col) ?? '') !== f.value) { pass = false; break; }
          } else {
            if (!String(readField(cursor, f.col) ?? '').toLowerCase().includes(f.needle)) { pass = false; break; }
          }
        }
        if (pass) indices.push(seq);
      }
    }

    // Sort if needed
    if (sort) {
      const col = COLUMNS.find(c => c.path === sort.column);
      if (col) {
        const sortValues = new Map<number, unknown>();
        for (const seq of indices) {
          cursor.seek(seq);
          sortValues.set(seq, readField(cursor, col));
        }
        const dir = sort.direction === 'asc' ? 1 : -1;
        indices.sort((a, b) => dir * compareValues(sortValues.get(a), sortValues.get(b)));
      }
    }

    return indices;
  }, [totalRecords, debouncedFilters, sort]);

  return {
    status,
    totalRecords,
    filteredCount: filteredIndices.length,
    columns: COLUMNS,
    columnStats,
    columnCardinality,
    filteredIndices,
    cursor: cursorRef.current,
    filters,
    sort,
    onFilterChange,
    onSortChange,
    error,
  };
}

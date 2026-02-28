/**
 * useJsonStrand — drives the two-phase JSON → Strand → virtualizer pipeline.
 *
 * Phase 1  spawn worker → send scan  → receive stats → build schema + SAB
 * Phase 2  send stream → drain loop  → acknowledgeRead (ALL records)
 * Filter   useMemo over debouncedFilters — zero-copy seq scan, no JS objects
 *
 * The hook is fully generic: it is parameterized by FieldDef[] so the same
 * hook works for any flat or nested JSON array, not just library.json.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  buildSchema,
  computeStrandMap,
  initStrandHeader,
  StrandView,
  type RecordCursor,
  type FilterPredicate,
  type ConstrainedRanges,
} from '@strand/core';
import type { FieldType } from '@strand/core';
import type { FieldDef, StatsPayload, SchemaPayload } from '../workers/jsonStrandWorker';

// ── Public types ──────────────────────────────────────────────────────────────

export type JsonStrandStatus = 'init' | 'inferring' | 'scanning' | 'streaming' | 'ready' | 'error';

export interface UseJsonStrandResult {
  status:          JsonStrandStatus;
  totalRecords:    number;
  filteredCount:   number;
  filteredIndices: number[];
  cursor:          RecordCursor | null;
  /** min/max for every numeric field — populated progressively during drain. */
  numericStats:    Record<string, { min: number; max: number }>;
  /** Sorted distinct values for every utf8_ref field. */
  cardinality:     Record<string, string[]>;
  /** The global intern table — index N resolves utf8_ref handle N for any field. */
  internTable:     string[];
  fields:          FieldDef[];
  error:           string | null;
  filters:         Record<string, string>;
  /** Debounced (150 ms) copy of filters — stable between keystrokes. */
  debFilters:      Record<string, string>;
  onFilterChange:  (name: string, value: string) => void;
  /** Per-field min/max derived from the records that pass the active filter intersection. */
  constrainedRanges: ConstrainedRanges;
  /** Number of records that pass the current constraint intersection. */
  constrainedCount:  number;
  /**
   * Send a get_constraints request to the worker with the given predicates.
   * The worker posts back { type: 'constraints', ranges, filteredCount }.
   * Call this whenever the combined filter state changes (debounced numeric
   * ranges + multi-select handle sets).
   */
  onConstraintRequest: (predicates: { field: string; predicate: FilterPredicate }[]) => void;
  /**
   * Display-character min/max/avg per field, measured during Phase 1 using
   * the same formatting rules as the UI.  Use to seed initial column widths.
   */
  fieldWidths: Record<string, { min: number; max: number; avg: number }>;
}

// ── SAB sizing constants ──────────────────────────────────────────────────────
//
// index_capacity MUST be a power of 2 AND must be >= total record count so
// that cursor.seek(seq) can reach any committed record without the ring having
// wrapped over it.  Sized dynamically from stats.recordCount at stream time.
//
// heap_capacity covers all utf8 field bytes across all records.
// Estimate: 5 utf8 fields × avg 15 bytes × 70 499 records ≈ 5.3 MB.
// 12 MB gives a comfortable 2× margin.

const HEAP_CAPACITY  = 12 * 1024 * 1024; // 12 MB
const BATCH_SIZE     = 500;

/** Next power of 2 >= n, clamped to a maximum of 2^22 (~4 M records). */
function nextPow2Capacity(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return Math.min(p, 1 << 22); // cap at ~4M
}

// ── Numeric type set ──────────────────────────────────────────────────────────
// Mirrors the worker's NUMERIC_TYPES. i64 excluded — BigInt doesn't fit in JS
// number arithmetic used by the stats accumulator and range filter.

const NUMERIC_TYPES = new Set<FieldType>(['i32', 'u32', 'f32', 'f64', 'u8', 'u16']);

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useJsonStrand(url: string, fieldsOrAuto: FieldDef[] | 'auto'): UseJsonStrandResult {
  const auto         = fieldsOrAuto === 'auto';
  const staticFields = auto ? null : fieldsOrAuto;

  const [status,         setStatus]       = useState<JsonStrandStatus>('init');
  // Resolved fields: caller-supplied immediately, or inferred after Phase 0.
  const [resolvedFields, setResolvedFields] = useState<FieldDef[]>(staticFields ?? []);
  const [totalRecords, setTotal]       = useState(0);
  const [numericStats, setNumStats]    = useState<Record<string, { min: number; max: number }>>({});
  const [cardinality,  setCard]        = useState<Record<string, string[]>>({});
  const [internTable,  setInternTable] = useState<string[]>([]);
  const [error,        setError]       = useState<string | null>(null);
  const [filters,      setFilters]     = useState<Record<string, string>>({});
  const [debFilters,   setDebFilters]  = useState<Record<string, string>>({});
  const [constrainedRanges, setConstrainedRanges] = useState<ConstrainedRanges>({});
  const [constrainedCount,  setConstrainedCount]  = useState(0);
  const [fieldWidths,       setFieldWidths]        = useState<Record<string, { min: number; max: number; avg: number }>>({});

  const viewRef     = useRef<StrandView   | null>(null);
  const cursorRef   = useRef<RecordCursor | null>(null);
  const workerRef   = useRef<Worker       | null>(null);
  const debRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so the worker message closure always sees the current field list even
  // before React has re-rendered (avoids stale-closure bugs in auto mode).
  const fieldsRef   = useRef<FieldDef[]>(staticFields ?? []);

  // ── Spawn worker, run Phase 1 + Phase 2 ────────────────────────────────────

  useEffect(() => {
    if (!crossOriginIsolated) {
      setError('SharedArrayBuffer requires cross-origin isolation (COOP/COEP headers)');
      setStatus('error');
      return;
    }

    let cancelled = false;

    // Reset inferred fields when url changes in auto mode.
    if (auto) setResolvedFields([]);

    const worker = new Worker(
      new URL('../workers/jsonStrandWorker.ts', import.meta.url),
      { type: 'module' },
    );

    workerRef.current = worker;

    // ── Worker crash handler ─────────────────────────────────────────────────
    // Without this, any unhandled exception inside the worker (OOM, unrecoverable
    // error outside a try/catch) silently kills it and the UI hangs forever.
    worker.onerror = (e: ErrorEvent) => {
      if (!cancelled) {
        setError(`Worker error: ${e.message ?? 'unknown'}`);
        setStatus('error');
      }
    };

    worker.onmessage = (e: MessageEvent) => {
      // ── Outer guard ────────────────────────────────────────────────────────
      // buildSchema / computeStrandMap / initStrandHeader / SharedArrayBuffer
      // can all throw. Without this guard, any exception in the 'stats' block
      // silently swallows itself — setStatus('streaming') is never called and
      // the UI hangs at 'scanning' indefinitely.
      let msg!: { type: string } & Record<string, unknown>;
      try { msg = e.data as typeof msg; } catch { return; }

      try {

      // ── Phase 0 complete: schema inferred, kick off Phase 1 scan ──────────
      if (msg.type === 'schema') {
        const schema = msg as unknown as SchemaPayload;
        if (cancelled) return;
        // Write ref first so the stats handler sees the fields synchronously.
        fieldsRef.current = schema.fields;
        setResolvedFields(schema.fields);
        setStatus('scanning');
        worker.postMessage({ type: 'scan', url, fields: schema.fields });
        return;
      }

      if (msg.type === 'stats') {
        const stats = msg as unknown as StatsPayload;

        // ── Global intern table comes directly from the worker ───────────────
        // The worker built it in Phase 1 from all utf8_ref cardinality sets.
        // We pass it straight through to the SAB header, StrandView, and back
        // to the worker in the stream message — no reconstruction needed here.
        const table = stats.internTable;

        // ── Build schema with real field names (Strand v5) ───────────────────
        const schema = buildSchema(
          fieldsRef.current.map(f => ({ name: f.name, type: f.type })),
        );

        // ── Allocate SAB — must happen on the main thread ────────────────────
        const map = computeStrandMap({
          schema,
          index_capacity:    nextPow2Capacity(stats.recordCount),
          heap_capacity:     HEAP_CAPACITY,
          query:             { assembly: 'json', chrom: '*', start: 0, end: 0 },
          estimated_records: stats.recordCount,
        });

        const sab = new SharedArrayBuffer(map.total_bytes);
        initStrandHeader(sab, map);

        // ── Consumer side — allocate view + cursor before handing SAB over ───
        const view   = new StrandView(sab, table);
        const cursor = view.allocateCursor();
        viewRef.current   = view;
        cursorRef.current = cursor;

        setInternTable(table);
        // Cardinality and field widths are fully computed in Phase 1 — set once.
        setCard(stats.cardinality);
        setFieldWidths(stats.fieldWidths);
        setStatus('streaming');

        // ── Drain loop ───────────────────────────────────────────────────────
        const numDefs = fieldsRef.current.filter(f => NUMERIC_TYPES.has(f.type));

        const accStats: Record<string, { min: number; max: number }> = {};
        for (const f of numDefs) accStats[f.name] = { min: Infinity, max: -Infinity };

        let after = 0;

        async function drain() {
          while (!cancelled) {
            const count = await view.waitForCommit(after, 2_000);
            if (cancelled) return;

            // Scan newly committed records for numeric stats — no JS objects created.
            for (let seq = after; seq < count; seq++) {
              cursor.seek(seq);
              for (const f of numDefs) {
                const v = readNumeric(cursor, f.name, f.type);
                if (isFinite(v)) {
                  const s = accStats[f.name]!;
                  if (v < s.min) s.min = v;
                  if (v > s.max) s.max = v;
                }
              }
            }

            // ── THE GOLDEN RULE ──────────────────────────────────────────────
            // acknowledgeRead MUST be called for every record consumed —
            // including records that will be filtered out of the UI.
            // Omitting this call or gating it on filter results causes the
            // ring to fill and permanently deadlocks the producer worker.
            view.acknowledgeRead(count);
            after = count;

            // Snapshot numeric stats into React state — drives range filter controls.
            const statsSnap: Record<string, { min: number; max: number }> = {};
            for (const key of Object.keys(accStats)) {
              const s = accStats[key]!;
              if (s.min !== Infinity) statsSnap[key] = { min: s.min, max: s.max };
            }

            setTotal(count);
            setNumStats(statsSnap);

            const st = view.status;
            if (st === 'eos' || st === 'error') {
              if (!cancelled) setStatus(st === 'error' ? 'error' : 'ready');
              return;
            }
          }
        }

        void drain();

        // ── Kick off Phase 2 — SAB transferred by reference (zero-copy) ─────
        worker.postMessage({
          type:        'stream',
          sab,
          internTable: table,
          batchSize:   BATCH_SIZE,
        });

      } else if (msg.type === 'done') {
        // Worker finalized — drain loop will detect 'eos' on next waitForCommit.
      } else if (msg.type === 'error') {
        if (!cancelled) {
          setError(String(msg.message));
          setStatus('error');
        }
      } else if (msg.type === 'constraints') {
        const c = msg as unknown as { ranges: ConstrainedRanges; filteredCount: number };
        if (!cancelled) {
          setConstrainedRanges(c.ranges);
          setConstrainedCount(c.filteredCount);
        }
      }

      } catch (err) {
        // Surface any synchronous exception thrown while processing worker messages.
        // This is the "catch" for the outer try added above the message handlers.
        if (!cancelled) {
          setError(`[strand] ${err instanceof Error ? err.message : String(err)}`);
          setStatus('error');
        }
      }
    };

    // Phase 0 (auto) or Phase 1 (static schema).
    if (auto) {
      setStatus('inferring');
      worker.postMessage({ type: 'infer', url });
    } else {
      setStatus('scanning');
      worker.postMessage({ type: 'scan', url, fields: staticFields! });
    }

    return () => {
      cancelled = true;
      // Signal producer to abort if still streaming.
      viewRef.current?.signalAbort();
      worker.terminate();
      workerRef.current = null;
      viewRef.current   = null;
      cursorRef.current = null;
    };
  // fields is expected to be a stable module-level constant — no dep churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ── Filter change (debounced 150 ms) ─────────────────────────────────────

  const onFilterChange = useCallback((name: string, value: string) => {
    setFilters(prev => ({ ...prev, [name]: value }));
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => {
      setDebFilters(prev => ({ ...prev, [name]: value }));
    }, 150);
  }, []);

  const onConstraintRequest = useCallback(
    (predicates: { field: string; predicate: FilterPredicate }[]) => {
      workerRef.current?.postMessage({ type: 'get_constraints', predicates });
    },
    [],
  );

  useEffect(() => () => { if (debRef.current) clearTimeout(debRef.current); }, []);

  // ── Zero-copy filter scan ─────────────────────────────────────────────────
  //
  // Runs synchronously on the main thread whenever totalRecords or debFilters
  // changes. Calls cursor.seek(seq) for every committed record — no JS object
  // created per row. Only integer seq values are pushed into the output array.

  const filteredIndices = useMemo(() => {
    const cursor = cursorRef.current;
    if (!cursor || totalRecords === 0) return [];

    const active = Object.entries(debFilters).filter(([, v]) => v.trim());

    // Fast path: no filters — return all seq values.
    if (active.length === 0) {
      return Array.from({ length: totalRecords }, (_, i) => i);
    }

    // Pre-parse filter descriptors once — avoids re-parsing inside the hot loop.
    type ParsedFilter =
      | { name: string; kind: 'between'; lo: number; hi: number; ftype: FieldType }
      | { name: string; kind: 'exact';   value: string }
      | { name: string; kind: 'search';  needle: string };

    const parsed: ParsedFilter[] = [];
    const fieldMap = new Map(resolvedFields.map(f => [f.name, f]));

    for (const [name, raw] of active) {
      const f = fieldMap.get(name);
      if (!f) continue;
      const t = raw.trim();

      const bm = t.match(/^BETWEEN\s+([\d.e+\-]+)\s+AND\s+([\d.e+\-]+)$/i);
      if (bm && NUMERIC_TYPES.has(f.type)) {
        parsed.push({ name, kind: 'between', lo: Number(bm[1]), hi: Number(bm[2]), ftype: f.type });
        continue;
      }
      const em = t.match(/^= '(.+)'$/);
      if (em && f.type === 'utf8_ref') {
        parsed.push({ name, kind: 'exact', value: em[1] });
        continue;
      }
      if (f.type === 'utf8') {
        parsed.push({ name, kind: 'search', needle: t.toLowerCase() });
      }
    }

    if (parsed.length === 0) {
      return Array.from({ length: totalRecords }, (_, i) => i);
    }

    // Hot loop — only integer pushes, zero JS object allocation.
    const indices: number[] = [];
    for (let seq = 0; seq < totalRecords; seq++) {
      cursor.seek(seq);
      let pass = true;

      for (const f of parsed) {
        if (f.kind === 'between') {
          const v = readNumeric(cursor, f.name, f.ftype);
          if (v < f.lo || v > f.hi) { pass = false; break; }

        } else if (f.kind === 'exact') {
          if (cursor.getRef(f.name) !== f.value) { pass = false; break; }

        } else {
          const s = cursor.getString(f.name) ?? '';
          if (!s.toLowerCase().includes(f.needle)) { pass = false; break; }
        }
      }

      if (pass) indices.push(seq); // integer only — no object allocation
    }

    return indices;
  }, [totalRecords, debFilters, resolvedFields]);

  return {
    status,
    totalRecords,
    filteredCount:   filteredIndices.length,
    filteredIndices,
    cursor:          cursorRef.current,
    numericStats,
    cardinality,
    internTable,
    fields:          resolvedFields,
    error,
    filters,
    debFilters,
    onFilterChange,
    constrainedRanges,
    constrainedCount,
    onConstraintRequest,
    fieldWidths,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read any supported numeric FieldType from the cursor as a JS number. */
function readNumeric(cursor: RecordCursor, name: string, type: FieldType): number {
  switch (type) {
    case 'i32': return cursor.getI32(name) ?? NaN;
    case 'u32': return cursor.getU32(name) ?? NaN;
    case 'f32': return cursor.getF32(name) ?? NaN;
    case 'f64': return cursor.getF64(name) ?? NaN;
    case 'u16': return cursor.getU16(name) ?? NaN;
    case 'u8':  return cursor.getU8(name)  ?? NaN;
    default:    return NaN;
  }
}

/**
 * jsonStrandWorker.ts — generic JSON → Strand streaming worker
 *
 * Three-phase lifecycle:
 *
 *   Phase 1  { type: 'scan', url, fields }
 *     Fetches the JSON array, parses it off-thread, and does one pass to
 *     compute column stats (min/max for numeric fields, cardinality sets for
 *     utf8_ref fields) and the global intern table.
 *     Posts { type: 'stats', recordCount, internTable, numericStats, cardinality }.
 *
 *   Phase 2  { type: 'stream', sab, internTable, batchSize }
 *     Main thread reflects the global intern table back with the initialised SAB.
 *     Worker builds one Map<string, number> from internTable, then iterates
 *     _records, resolves each jsonPath, maps utf8_ref strings to their u32
 *     handle, and writes via StrandWriter.
 *     writeRecordBatch uses Atomics.wait for lock-free backpressure — the
 *     worker thread stalls cleanly when the ring fills; no async/await needed.
 *
 *   Phase 3  { type: 'get_constraints', predicates: { field, predicate }[] }
 *     Fired by the main thread whenever the active filter set changes (debounced).
 *     Worker creates a StrandView over the saved SAB, builds one FilterPredicate
 *     bitset per active predicate, intersects them, then calls getConstrainedRanges
 *     to derive the per-field min/max within the matching set.
 *     Posts { type: 'constraints', ranges, filteredCount }.
 *     This is the "New Reality" — drives range-slider bound snapping on the UI.
 *
 * Schema is caller-supplied via FieldDef[]. The worker has no hardcoded
 * knowledge of any particular JSON shape — it resolves values by dot-notation
 * or explicit key-array path and categorises fields by declared FieldType.
 */

import type { FieldType } from '@strand/core';
import {
  StrandView,
  StrandWriter,
  StrandAbortError,
  computeIntersection,
  createBitset,
  popcount,
  type WritableValue,
  type WritableRecord,
  type FilterPredicate,
  type ConstrainedRanges,
} from '@strand/core';
import { inferFields } from '@strand/inference';
import type { FieldDef as InferredFieldDef } from '@strand/inference';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One column definition — passed by the caller in the scan message.
 *
 * `jsonPath` is either:
 *   - a dot-notation string: 'chrom', 'tags.off_targets', 'metadata.source'
 *   - a string array describing the explicit key path: ['tags', 'off_targets']
 *     (useful when keys contain dots or are dynamically constructed)
 *
 * Re-exported from @strand/inference for backwards compatibility with
 * consumers (useJsonStrand, DevJsonPage) that import FieldDef from here.
 */
export type { FieldDef } from '@strand/inference';

export interface StatsPayload {
  type:        'stats';
  recordCount: number;
  /**
   * Global deduped intern table built from all utf8_ref fields (field-declaration
   * order, alphabetically within each field). Index N resolves utf8_ref handle N
   * for any field — all utf8_ref fields share this single handle space.
   */
  internTable:  string[];
  /** Present for every field whose type is a numeric FieldType (i32, u32, f32, f64, u8, u16). */
  numericStats: Record<string, { min: number; max: number }>;
  /** Present for every field with type 'utf8_ref'. Sorted distinct values. */
  cardinality:  Record<string, string[]>;
  /**
   * Serialised display-character min/max/avg for every field, measured using
   * the same formatting rules as the UI (fmt()).  Lets the preview set initial
   * column widths from real data instead of hardcoded per-type guesses.
   */
  fieldWidths:  Record<string, { min: number; max: number; avg: number }>;
}

// ── Message types ─────────────────────────────────────────────────────────────

/**
 * Phase 0 (optional): auto-infer schema from the first N records.
 *
 * The worker fetches the JSON, runs inferFields() on the first N records,
 * caches the parsed array in _records (so Phase 1 scan skips the re-fetch),
 * and posts back { type: 'schema', fields: FieldDef[] }.
 *
 * The main thread then sends a scan message with those fields to proceed.
 */
interface InferMessage {
  type:       'infer';
  url:        string;
  /** Override the default sample size passed to inferFields(). Default: 500. */
  sampleSize?: number;
}

/** Posted in response to an InferMessage. */
export interface SchemaPayload {
  type:   'schema';
  fields: InferredFieldDef[];
}

interface ScanMessage {
  type:   'scan';
  url:    string;
  fields: InferredFieldDef[];
}

interface StreamMessage {
  type:        'stream';
  sab:         SharedArrayBuffer;
  /**
   * Global intern table — identical to internTable in the StatsPayload,
   * reflected back by the main thread alongside the initialised SAB.
   * Index N resolves utf8_ref handle N for every field.
   */
  internTable: string[];
  batchSize:   number;
}

interface GetConstraintsMessage {
  type:       'get_constraints';
  /**
   * One entry per active filter the main thread considers bitset-able.
   * Numeric BETWEEN predicates come from debounced range sliders.
   * utf8_ref `in` predicates come from multi-select selections (handles
   * pre-resolved by the main thread using the shared intern table).
   * utf8 substring filters are excluded — heap-indirected, not bitset-able.
   */
  predicates: { field: string; predicate: FilterPredicate }[];
}

// ── Module-level state ────────────────────────────────────────────────────────
// Phase 1→2 state: parsed records and field definitions.
// Phase 2→3 state: SAB reference and intern table kept for constraint queries.

let _records:    unknown[]              | null = null;
let _fields:     InferredFieldDef[]    | null = null;
let _sab:        SharedArrayBuffer  | null = null;
let _internTable: string[]          | null = null;

// ── Worker message handler ────────────────────────────────────────────────────

self.onmessage = (
  e: MessageEvent<InferMessage | ScanMessage | StreamMessage | GetConstraintsMessage>,
) => {
  const msg = e.data;
  if (msg.type === 'infer') {
    void handleInfer(msg.url, msg.sampleSize);
  } else if (msg.type === 'scan') {
    void handleScan(msg.url, msg.fields);
  } else if (msg.type === 'stream') {
    handleStream(msg.sab, msg.internTable, msg.batchSize);
  } else if (msg.type === 'get_constraints') {
    handleGetConstraints(msg.predicates);
  }
};

// ── Path resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a jsonPath against a raw JSON object.
 *
 * - string[]: direct key descent — ['tags', 'score'] navigates obj.tags.score
 *   without any string splitting. Handles keys that contain dots.
 *
 * - string: dot-notation — 'tags.score' is split on '.' and descended.
 *   Fast-paths the single-segment case (no dot) to a direct property access.
 *
 * Returns undefined when any intermediate node is null or non-object.
 */
function resolve(obj: unknown, jsonPath: string | string[]): unknown {
  if (Array.isArray(jsonPath)) {
    let cur: unknown = obj;
    for (const key of jsonPath) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
  }

  // Fast path: no dot → single top-level property.
  const dot = jsonPath.indexOf('.');
  if (dot === -1) return (obj as Record<string, unknown>)[jsonPath];

  let cur: unknown = obj;
  let start = 0;
  for (let i = 0; i <= jsonPath.length; i++) {
    if (i === jsonPath.length || jsonPath[i] === '.') {
      const key = jsonPath.slice(start, i);
      if (cur === null || typeof cur !== 'object') return undefined;
      cur   = (cur as Record<string, unknown>)[key];
      start = i + 1;
    }
  }
  return cur;
}

// ── Display-length measurement ────────────────────────────────────────────────
// Mirrors the fmt() function in JsonStrandPreview so the measured character
// count matches exactly what the virtualizer will render.  Used in the Phase 1
// scan to build per-field min/max/avg display widths for column auto-sizing.

function measureDisplayLen(raw: unknown, type: FieldType): number {
  if (raw == null) return 1;
  switch (type) {
    case 'f32':
    case 'f64': {
      const n = Number(raw);
      return isFinite(n) ? n.toFixed(2).length : 3; // 'NaN'
    }
    case 'i32':
    case 'u32':
    case 'u16':
    case 'u8': {
      const n = Number(raw);
      if (!isFinite(n)) return 3;
      const a = Math.abs(n);
      if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).length + 1; // '1.2M'
      if (a >= 10_000)    return (n / 1_000).toFixed(1).length + 1;     // '12.3K'
      return n.toLocaleString().length;
    }
    case 'i64':
      return String(raw).length;
    case 'bool8':
      return raw ? 4 : 5; // 'true' / 'false'
    case 'json':
      return Math.min(JSON.stringify(raw).length, 32);
    case 'utf8':
    case 'utf8_ref':
    default:
      return Math.min(String(raw).length, 32); // cap matches fmt() truncation
  }
}

// ── Numeric type set ──────────────────────────────────────────────────────────
// i64 is intentionally excluded: the stats accumulator uses JS number arithmetic,
// and BigInt comparison is non-standard. Pass i64 range stats server-side if needed.

const NUMERIC_TYPES = new Set<FieldType>(['i32', 'u32', 'f32', 'f64', 'u8', 'u16']);

// ── Phase 0: schema inference ─────────────────────────────────────────────────

/**
 * Fetch the JSON array, run inferFields() on the first sampleSize records,
 * cache the parsed array so Phase 1 (scan) can reuse it without re-fetching,
 * and post { type: 'schema', fields }.
 *
 * Failure posts { type: 'error', message }.
 */
async function handleInfer(url: string, sampleSize = 500): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

    const parsed = await res.json() as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array at the top level.');
    }

    // Cache for Phase 1 — avoids a second HTTP round-trip.
    _records = parsed;

    const fields = inferFields(parsed, { sampleSize });
    const payload: SchemaPayload = { type: 'schema', fields };
    self.postMessage(payload);

  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
}

// ── Phase 1: fetch, parse, scan ───────────────────────────────────────────────

async function handleScan(url: string, fields: InferredFieldDef[]): Promise<void> {
  try {
    // If Phase 0 (handleInfer) already fetched and cached _records, skip the
    // HTTP round-trip. Otherwise fetch now (direct scan without prior infer).
    if (!_records) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      // JSON.parse runs off the main thread — no GC pressure on the UI.
      _records = await res.json() as unknown[];
    }

    _fields = fields;

    if (!Array.isArray(_records)) {
      throw new Error('Expected a JSON array at the top level.');
    }

    const categoricals = fields.filter(f => f.type === 'utf8_ref');

    const numericStats: Record<string, { min: number; max: number }> = {};
    for (const f of fields) {
      if (NUMERIC_TYPES.has(f.type)) numericStats[f.name] = { min: Infinity, max: -Infinity };
    }

    const cardSets: Record<string, Set<string>> = {};
    for (const f of categoricals) cardSets[f.name] = new Set<string>();

    // Width accumulators — track display-char length to auto-size columns.
    // min/max/sum in one pass; avg computed after.
    const widthAcc: Record<string, { min: number; max: number; sum: number }> = {};
    for (const f of fields) widthAcc[f.name] = { min: Infinity, max: 0, sum: 0 };

    // ── Single-pass scan — numeric stats + cardinality + display widths ──────
    // One resolve() call per field per record. No intermediate JS objects.

    for (const rec of _records) {
      for (const f of fields) {
        const raw = resolve(rec, f.jsonPath);

        // Numeric stats
        if (NUMERIC_TYPES.has(f.type)) {
          const v = Number(raw);
          if (isFinite(v)) {
            const s = numericStats[f.name]!;
            if (v < s.min) s.min = v;
            if (v > s.max) s.max = v;
          }
        }

        // Cardinality
        if (f.type === 'utf8_ref') {
          const v = String(raw ?? '');
          if (v) cardSets[f.name]!.add(v);
        }

        // Display-width tracking — mirrors fmt() in JsonStrandPreview
        const len = measureDisplayLen(raw, f.type);
        const w   = widthAcc[f.name]!;
        if (len < w.min) w.min = len;
        if (len > w.max) w.max = len;
        w.sum += len;
      }
    }

    // Sort cardinality sets — deterministic order ensures stable handles across
    // reloads and workers.
    const cardinality: Record<string, string[]> = {};
    for (const f of categoricals) {
      cardinality[f.name] = [...cardSets[f.name]!].sort();
    }

    // ── Build global intern table ────────────────────────────────────────────
    // All utf8_ref fields share one handle space. Build in field-declaration
    // order (alphabetically within each field via sorted cardinality above)
    // so handles are deterministic and stable across reruns.
    const seen        = new Set<string>();
    const internTable: string[] = [];
    for (const f of categoricals) {
      for (const v of cardinality[f.name]!) {
        if (!seen.has(v)) { seen.add(v); internTable.push(v); }
      }
    }

    // Finalise fieldWidths: collapse sum→avg, guard empty files.
    const n = _records.length || 1;
    const fieldWidths: Record<string, { min: number; max: number; avg: number }> = {};
    for (const f of fields) {
      const w = widthAcc[f.name]!;
      fieldWidths[f.name] = {
        min: w.min === Infinity ? 0 : w.min,
        max: w.max,
        avg: w.sum / n,
      };
    }

    const payload: StatsPayload = {
      type:        'stats',
      recordCount: _records.length,
      internTable,
      numericStats,
      cardinality,
      fieldWidths,
    };

    self.postMessage(payload);

  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
}

// ── Phase 2: stream _records into Strand ─────────────────────────────────────

function handleStream(
  sab:         SharedArrayBuffer,
  internTable: string[],
  batchSize:   number,
): void {
  if (!_records || !_fields) {
    self.postMessage({ type: 'error', message: 'stream received before scan completed' });
    return;
  }

  // Save for Phase 3 constraint queries — both outlive Phase 2.
  _sab         = sab;
  _internTable = internTable;

  // Build O(1) string → u32 handle lookup from the global intern table.
  // All utf8_ref fields share this handle space — handle N resolves to
  // internTable[N] for any field regardless of which field it came from.
  const handle = new Map<string, number>();
  for (let i = 0; i < internTable.length; i++) {
    handle.set(internTable[i]!, i);
  }

  // Loud failure on missing handles — a value not in the global intern table
  // means the Phase 1 stats scan was incomplete. Fail fast.
  function h(value: string): number {
    const idx = handle.get(value);
    if (idx === undefined) {
      throw new Error(`Missing intern handle for value: "${value}"`);
    }
    return idx;
  }

  // Capture before nulling in finally.
  const records = _records;
  const fields  = _fields;
  const total   = records.length;

  const writer = new StrandWriter(sab);

  try {
    writer.begin();

    for (let offset = 0; offset < total; offset += batchSize) {
      const end   = Math.min(offset + batchSize, total);
      const batch: WritableRecord[] = [];

      for (let i = offset; i < end; i++) {
        const rec: Record<string, WritableValue> = {};
        const source = records[i];

        for (const f of fields) {
          const raw = resolve(source, f.jsonPath);

          switch (f.type) {
            case 'utf8_ref':
              // Map the string value to its global u32 handle.
              rec[f.name] = h(String(raw ?? ''));
              break;

            case 'i32':
              // Signed 32-bit — bitwise OR truncates to int32 range.
              rec[f.name] = Number(raw) | 0;
              break;

            case 'u32':
            case 'u16':
            case 'u8':
              // Unsigned — zero-fill right-shift coerces to unsigned 32-bit;
              // StrandWriter masks to the field's actual bit width.
              rec[f.name] = Number(raw) >>> 0;
              break;

            case 'f32':
            case 'f64':
              rec[f.name] = Number(raw);
              break;

            case 'i64':
              // JSON numbers are IEEE doubles — precision is lost above 2^53.
              // For source values already stored as strings or BigInt, pass
              // through directly; otherwise truncate via Math.trunc.
              rec[f.name] = typeof raw === 'bigint'
                ? raw
                : BigInt(Math.trunc(Number(raw) || 0));
              break;

            case 'bool8':
              rec[f.name] = raw ? 1 : 0;
              break;

            case 'json':
              // StrandWriter calls JSON.stringify internally; pass the object.
              rec[f.name] = raw ?? null;
              break;

            case 'bytes':
            case 'i32_array':
            case 'f32_array':
              // Typed array fields: pass through as-is.
              rec[f.name] = raw ?? null;
              break;

            case 'utf8':
            default:
              // Variable-length string — StrandWriter encodes to the heap region.
              rec[f.name] = raw != null ? String(raw) : '';
              break;
          }
        }

        batch.push(rec);
      }

      // Atomics.wait inside writeRecordBatch stalls this thread when the ring
      // is full. The main thread's drain loop advances the read cursor, waking us.
      writer.writeRecordBatch(batch);
    }

    writer.finalize();

  } catch (err) {
    if (err instanceof StrandAbortError) {
      writer.abort();
      self.postMessage({ type: 'error', message: `Aborted: ${err.message}` });
      return;
    }
    writer.abort();
    self.postMessage({ type: 'error', message: String(err) });
    return;
  } finally {
    // Free the parsed JS objects once all records are in the SAB.
    _records = null;
    _fields  = null;
  }

  self.postMessage({ type: 'done' });
}

// ── Phase 3: constraint query ─────────────────────────────────────────────────

/**
 * Build a bitset intersection from the supplied predicates, then derive the
 * per-field min/max "reality" for every numeric field in the matching set.
 *
 * Posted back as { type: 'constraints', ranges: ConstrainedRanges, filteredCount }.
 *
 * Non-fatal: on any error, posts empty ranges so the UI degrades gracefully.
 */
function handleGetConstraints(
  predicates: { field: string; predicate: FilterPredicate }[],
): void {
  if (!_sab) {
    self.postMessage({ type: 'constraints', ranges: {} as ConstrainedRanges, filteredCount: 0 });
    return;
  }

  try {
    const view       = new StrandView(_sab, _internTable ?? []);
    const committed  = view.committedCount;
    const startSeq   = view.windowStart;
    const windowSize = committed - startSeq;

    if (windowSize === 0) {
      self.postMessage({ type: 'constraints', ranges: {} as ConstrainedRanges, filteredCount: 0 });
      return;
    }

    // Build intersection bitset — or all-ones if no predicates are active.
    let intersection: Uint32Array;

    if (predicates.length === 0) {
      // All records match — fill every bit within the window.
      intersection = createBitset(windowSize);
      intersection.fill(0xFFFFFFFF);
      const tail = windowSize & 31;
      if (tail !== 0) intersection[intersection.length - 1] = (1 << tail) - 1;
    } else {
      const bitsets = predicates.map(({ field, predicate }) =>
        view.getFilterBitset(field, predicate),
      );
      intersection = computeIntersection(bitsets);
    }

    const ranges: ConstrainedRanges = view.getConstrainedRanges(intersection);
    const filteredCount = popcount(intersection, windowSize);

    self.postMessage({ type: 'constraints', ranges, filteredCount });

  } catch (_err) {
    // Non-fatal — main thread degrades gracefully to full-range sliders.
    self.postMessage({ type: 'constraints', ranges: {} as ConstrainedRanges, filteredCount: 0 });
  }
}

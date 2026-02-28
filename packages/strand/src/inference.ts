/**
 * inference.ts — Stateless JSON schema inference → FieldDef[]
 *
 * Standalone module. Zero runtime dependencies beyond the FieldType union
 * from @strand/core (imported via relative path so this file resolves without
 * any bundler alias configuration).
 *
 * API surface:
 *
 *   inferFields(records, options?) → FieldDef[]
 *
 * Guarantees:
 *   • Stateless  — pure function, no module-level mutation.
 *   • Promotion  — a field that is mostly i32 but has one f64 is promoted to f64.
 *                  Mixed numeric+string fields degrade to utf8.
 *   • Cardinality — string fields with ≤ CARD_MAX distinct values across the
 *                  sample are classified as utf8_ref (SAB intern table entry).
 *                  High-cardinality or fast-growing string fields stay utf8.
 *   • Flattening  — nested objects are recursed up to MAX_DEPTH levels,
 *                  producing dot-notation paths (e.g. "tags.off_targets").
 *                  Arrays and objects beyond MAX_DEPTH are classified as json.
 *   • Stability   — output order matches first-seen path order across the sample.
 *   • Uniqueness  — if two paths share the same leaf segment, both are fully
 *                  qualified (dots replaced with underscores) so FieldDef.name
 *                  is always unique.
 */

import type { FieldType } from '../../../vendor/strand/src/types';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One column definition compatible with jsonStrandWorker's scan + stream phases.
 *
 * Note: inference always produces string jsonPaths (dot-notation). The worker
 * FieldDef also accepts string[] for programmatically constructed paths; those
 * are not produced here but the types are structurally compatible.
 */
export interface FieldDef {
  /** Column name — last path segment, or fully-qualified (underscored) on collision. */
  name:     string;
  /** Strand field type selected by the inference engine. */
  type:     FieldType;
  /** Dot-notation extraction path into the source JSON record (e.g. "tags.score"). */
  jsonPath: string;
}

/** Options controlling inference behaviour. */
export interface InferOptions {
  /**
   * Maximum records to sample for type and cardinality analysis.
   * Larger values improve cardinality accuracy at the cost of more CPU.
   * Default: 500.
   */
  sampleSize?: number;
  /**
   * A string field with ≤ cardMax distinct values across the sample is
   * classified as utf8_ref (interned). Default: 100.
   */
  cardMax?: number;
  /**
   * If distinct/observed > cardRatio the field stays utf8 even when
   * distinct ≤ cardMax, because it's growing too fast to intern safely.
   * Default: 0.5.
   */
  cardRatio?: number;
  /**
   * Maximum nesting depth for object recursion. Objects deeper than this
   * are treated as json blobs. Default: 5.
   */
  maxDepth?: number;
}

// ── Internal types ────────────────────────────────────────────────────────────

/**
 * Primitive kinds the classifier can assign to a single observed value.
 * Kept separate from FieldType so promotion rules are explicit.
 */
type ObservedKind = 'i32' | 'f64' | 'bool8' | 'utf8' | 'json' | 'null';

interface FieldAccum {
  /** Set of kinds observed for this path across the sample. */
  kinds:    Set<ObservedKind>;
  /**
   * Collected distinct string values — only populated while size ≤ cardMax.
   * Used for the utf8 → utf8_ref promotion decision.
   */
  distinct: Set<string>;
  /** Total non-null observations for this path. */
  seen:     number;
  /** Insertion order index — ensures stable output ordering. */
  order:    number;
}

// ── Value classifier ──────────────────────────────────────────────────────────

function classifyScalar(v: unknown): ObservedKind {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean')        return 'bool8';
  if (typeof v === 'bigint')         return 'f64';     // coerced to double at write time
  if (typeof v === 'number') {
    if (!isFinite(v))                              return 'f64';
    if (!Number.isInteger(v))                     return 'f64';
    if (v < -2_147_483_648 || v > 2_147_483_647) return 'f64'; // out of i32 range
    return 'i32';
  }
  if (typeof v === 'string') return 'utf8';
  // object (non-null), array — caller dispatches; reaching here means depth cap hit
  return 'json';
}

// ── Accumulator update (recursive) ───────────────────────────────────────────

function observe(
  path:     string,
  value:    unknown,
  depth:    number,
  accums:   Map<string, FieldAccum>,
  cardMax:  number,
  maxDepth: number,
): void {
  // Recurse into plain objects (not arrays) up to maxDepth.
  if (
    depth < maxDepth &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      observe(
        path ? `${path}.${key}` : key,
        child,
        depth + 1,
        accums,
        cardMax,
        maxDepth,
      );
    }
    return; // don't register the object itself — only its leaf fields
  }

  // Leaf value (scalar, array, or depth-capped object).
  const kind = classifyScalar(value);
  let acc = accums.get(path);
  if (!acc) {
    acc = { kinds: new Set(), distinct: new Set(), seen: 0, order: accums.size };
    accums.set(path, acc);
  }

  acc.kinds.add(kind);
  if (kind !== 'null') acc.seen++;

  // Track distinct values only while still below the cardinality cap.
  // Once we exceed cardMax we know it's utf8, so further tracking is wasteful.
  if (kind === 'utf8' && typeof value === 'string' && acc.distinct.size <= cardMax) {
    acc.distinct.add(value as string);
  }
}

// ── Type promotion ────────────────────────────────────────────────────────────

function resolveType(acc: FieldAccum, cardMax: number, cardRatio: number): FieldType {
  const { kinds, distinct, seen } = acc;

  // Filter out null — it only tells us the field is optional.
  const concrete = new Set([...kinds].filter((k): k is Exclude<ObservedKind, 'null'> => k !== 'null'));

  // All-null field: safe fallback so the SAB slot still exists.
  if (concrete.size === 0) return 'utf8';

  // json wins over everything (arrays, depth-capped objects).
  if (concrete.has('json')) return 'json';

  // Pure boolean: always treat as 2-value categorical so the UI renders
  // a MultiSelect ("true" / "false") rather than no filter control at all.
  // The worker writes String(raw) → intern handle, same as any utf8_ref field.
  if (concrete.size === 1 && concrete.has('bool8')) return 'utf8_ref';

  const hasNum  = concrete.has('i32') || concrete.has('f64');
  const hasBool = concrete.has('bool8');
  const hasStr  = concrete.has('utf8');

  if (hasNum && !hasStr) {
    // bool coerced alongside numbers → widen to f64 (0.0 / 1.0).
    if (concrete.has('f64') || hasBool) return 'f64';
    return 'i32';
  }

  if (hasStr) {
    // Mixed string + numeric types → stringify everything.
    if (hasNum) return 'utf8';

    // Pure string field: apply cardinality gate.
    // Fields with very few distinct values are ALWAYS categorical regardless
    // of the ratio heuristic — a 2-value field like +/- is always utf8_ref
    // even if the sample happens to be small relative to the distinct count.
    if (distinct.size <= 8) return 'utf8_ref';
    const ratio = seen > 0 ? distinct.size / seen : 1;
    if (distinct.size <= cardMax && ratio <= cardRatio) return 'utf8_ref';
    return 'utf8';
  }

  return 'utf8'; // unreachable in practice; satisfies exhaustiveness
}

// ── Name collision resolution ─────────────────────────────────────────────────

/**
 * Build field names from paths.
 * - Use the last dot-segment as the name when it is unique across all paths.
 * - Fall back to the full path with dots replaced by underscores on collision.
 */
function buildNames(paths: string[]): Map<string, string> {
  // Count how many paths share each leaf segment.
  const leafCount = new Map<string, number>();
  for (const path of paths) {
    const leaf = path.split('.').pop()!;
    leafCount.set(leaf, (leafCount.get(leaf) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  for (const path of paths) {
    const leaf = path.split('.').pop()!;
    result.set(path, (leafCount.get(leaf)! > 1) ? path.replace(/\./g, '_') : leaf);
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Infer a FieldDef[] from a sample of raw JSON records.
 *
 * @param records   Array of parsed JSON objects. Only the first `sampleSize`
 *                  entries are analysed; passing the full dataset is safe.
 * @param options   Optional tuning parameters (see InferOptions).
 * @returns         Stable FieldDef[] in first-seen path order.
 *
 * @example
 *   const fields = inferFields(records);
 *   // [{ name: 'chrom', type: 'utf8_ref', jsonPath: 'chrom' }, ...]
 *   worker.postMessage({ type: 'scan', url, fields });
 */
export function inferFields(
  records:  unknown[],
  options:  InferOptions = {},
): FieldDef[] {
  const sampleSize = options.sampleSize ?? 500;
  const cardMax    = options.cardMax    ?? 100;
  const cardRatio  = options.cardRatio  ?? 0.5;
  const maxDepth   = options.maxDepth   ?? 5;

  const accums = new Map<string, FieldAccum>();
  const limit  = Math.min(records.length, sampleSize);

  for (let i = 0; i < limit; i++) {
    const rec = records[i];
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) continue;
    for (const [key, val] of Object.entries(rec as Record<string, unknown>)) {
      observe(key, val, 0, accums, cardMax, maxDepth);
    }
  }

  // Sort paths by insertion order to preserve first-seen stability.
  const sorted = [...accums.entries()].sort((a, b) => a[1].order - b[1].order);
  const paths  = sorted.map(([path]) => path);
  const names  = buildNames(paths);

  return sorted.map(([path, acc]) => ({
    name:     names.get(path)!,
    type:     resolveType(acc, cardMax, cardRatio),
    jsonPath: path,
  }));
}

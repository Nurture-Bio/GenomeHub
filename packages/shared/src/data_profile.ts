/**
 * DataProfile — the single source of truth for computed Parquet metadata.
 *
 * Three-state semantics enforced by the type system:
 *   undefined → never attempted → trigger DuckDB compute
 *   null      → attempted and failed → do not retry (negative cache)
 *   {...}     → computed successfully → serve from cache
 *
 * To add a new attribute:
 *   1. Add the data shape interface below
 *   2. Add one line to EnrichableAttributes
 *   3. Add a case to hydrateAttribute() on the server
 *   4. Write the enrichment function
 *
 * @module
 */

// ── JSON primitive — the exact domain of JSONB-serializable values ────────────
// Interfaces are lazily evaluated by TypeScript, breaking the infinite recursion
// that TypeORM's QueryDeepPartialEntity triggers on inline recursive type literals.

export interface JsonObject {
  [key: string]: JsonValue;
}
export interface JsonArray extends Array<JsonValue> {}
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;

// ── Raw data shapes (pure data, no optionality) ─────────────────────────────

export interface DataProfileColumn {
  name: string;
  type: string; // DuckDB type string, e.g. "BIGINT", "VARCHAR"
}

export interface DataProfileStats {
  min: number;
  max: number;
  nullCount: number;
}

export interface DataProfileCardinality {
  distinct: number;
  topValues?: { value: string; count: number }[];
}

export interface DataProfileCharLengths {
  min: number;
  max: number;
}

// ── Enrichable Manifest — the ONLY place to register new lazy attributes ────

export interface EnrichableAttributes {
  columnStats: Record<string, DataProfileStats>;
  cardinality: Record<string, DataProfileCardinality>;
  charLengths: Record<string, DataProfileCharLengths>;
  initialRows: JsonObject[];
  histograms: Record<string, number[]>;
}

// ── Histogram helpers — shared between server and client DuckDB ──────────────

export const HISTOGRAM_BINS = 64;

/** DuckDB SQL expression: maps a value into a 0-indexed bin, clamped to [0, BINS-1]. */
export function histogramBucketSql(
  col: string,
  min: number,
  max: number,
  bins = HISTOGRAM_BINS,
): string {
  return `LEAST(GREATEST(FLOOR((${col}::DOUBLE - ${min}::DOUBLE) / (${max}::DOUBLE - ${min}::DOUBLE) * ${bins}), 0), ${bins - 1})::INTEGER`;
}

// ── Lazy Wrapper — T | null (null = negative cache, do not retry) ───────────

export type Lazy<T> = T | null;

// ── DataProfile = base ∩ mapped lazy attributes ─────────────────────────────

export type DataProfile = {
  schema: DataProfileColumn[];
  rowCount: number;
  profiledAt?: string;
} & {
  [K in keyof EnrichableAttributes]?: Lazy<EnrichableAttributes[K]>;
};

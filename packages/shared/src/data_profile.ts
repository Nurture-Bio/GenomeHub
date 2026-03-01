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

// ── Raw data shapes (pure data, no optionality) ─────────────────────────────

export interface DataProfileColumn {
  name: string;
  type: string;   // DuckDB type string, e.g. "BIGINT", "VARCHAR"
}

export interface DataProfileStats {
  min:       number;
  max:       number;
  nullCount: number;
}

export interface DataProfileCardinality {
  distinct:   number;
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
}

// ── Lazy Wrapper — T | null (null = negative cache, do not retry) ───────────

export type Lazy<T> = T | null;

// ── DataProfile = base ∩ mapped lazy attributes ─────────────────────────────

export type DataProfile = {
  schema:      DataProfileColumn[];
  rowCount:    number;
  profiledAt?: string;
} & {
  [K in keyof EnrichableAttributes]?: Lazy<EnrichableAttributes[K]>;
};

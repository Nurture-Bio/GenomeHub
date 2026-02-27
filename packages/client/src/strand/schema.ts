import { buildSchema, type FieldType, type BinarySchemaDescriptor } from '@strand/core';

// ── Intern table ─────────────────────────────────────────
// Indices 0–33: contig names, 34–35: strand, 36: pattern, 37–40: matched PAMs, 41: feature_type

const CHROMS = Array.from({ length: 34 }, (_, i) => `contig_${i < 12 ? i + 22 : i + 90}`);

export const INTERN_TABLE: readonly string[] = [
  ...CHROMS,          // 0–33
  '+', '-',           // 34, 35
  'NGG',              // 36
  'AGG', 'TGG', 'CGG', 'GGG',  // 37–40
  'promoter',         // 41
];

// Pre-compute handle lookups for the worker
export const INTERN_HANDLES: Record<string, number> = {};
for (let i = 0; i < INTERN_TABLE.length; i++) {
  INTERN_HANDLES[INTERN_TABLE[i]] = i;
}

// ── Column metadata ──────────────────────────────────────
// Real field names live here, not in the strand schema.
// The schema uses indexed names (f0, f1, ...) so arbitrary JSON
// field names of any length work within the 420-byte header.

export type DuckType = 'VARCHAR' | 'INTEGER' | 'DOUBLE';

export interface StrandColumnMeta {
  /** Strand field name — always `fN` where N is the column index */
  field:      string;
  /** Index into the column array (matches the N in fN) */
  index:      number;
  /** Display label (leaf name) */
  label:      string;
  /** Display path for filters (e.g. "tags.matched") */
  path:       string;
  /** DuckDB-compatible type for formatting/filtering */
  duckType:   DuckType;
  /** Strand field type */
  strandType: FieldType;
}

// Column definitions — order determines fN index
const COLUMN_DEFS: Array<{
  label: string;
  path:  string;
  duckType: DuckType;
  strandType: FieldType;
}> = [
  { label: 'chrom',           path: 'chrom',                duckType: 'VARCHAR',  strandType: 'utf8_ref' },
  { label: 'start',           path: 'start',               duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'end',             path: 'end',                 duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'strand',          path: 'strand',              duckType: 'VARCHAR',  strandType: 'utf8_ref' },
  { label: 'score',           path: 'score',               duckType: 'DOUBLE',   strandType: 'f64' },
  { label: 'name',            path: 'name',                duckType: 'VARCHAR',  strandType: 'utf8' },
  { label: 'pattern',         path: 'tags.pattern',        duckType: 'VARCHAR',  strandType: 'utf8_ref' },
  { label: 'matched',         path: 'tags.matched',        duckType: 'VARCHAR',  strandType: 'utf8_ref' },
  { label: 'guide_id',        path: 'tags.guide_id',       duckType: 'VARCHAR',  strandType: 'utf8' },
  { label: 'pam_start',       path: 'tags.pam_start',      duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'pam_end',         path: 'tags.pam_end',        duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'spacer',          path: 'tags.spacer',         duckType: 'VARCHAR',  strandType: 'utf8' },
  { label: 'guide_seq',       path: 'tags.guide_seq',      duckType: 'VARCHAR',  strandType: 'utf8' },
  { label: 'total_sites',     path: 'tags.total_sites',    duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'off_targets',     path: 'tags.off_targets',    duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'feature_name',    path: 'tags.feature_name',   duckType: 'VARCHAR',  strandType: 'utf8' },
  { label: 'feature_type',    path: 'tags.feature_type',   duckType: 'VARCHAR',  strandType: 'utf8_ref' },
  { label: 'feature_start',   path: 'tags.feature_start',  duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'feature_end',     path: 'tags.feature_end',    duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'feature_strand',  path: 'tags.feature_strand', duckType: 'VARCHAR',  strandType: 'utf8_ref' },
  { label: 'overlap',         path: 'tags.overlap',        duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'offset',          path: 'tags.offset',         duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'signed_distance', path: 'tags.signed_distance',duckType: 'INTEGER',  strandType: 'i32' },
  { label: 'relative_pos',    path: 'tags.relative_pos',   duckType: 'DOUBLE',   strandType: 'f64' },
];

// ── Build schema + columns from definitions ──────────────

export const SCHEMA: BinarySchemaDescriptor = buildSchema(
  COLUMN_DEFS.map((def, i) => ({ name: `f${i}`, type: def.strandType }))
);

export const COLUMNS: StrandColumnMeta[] = COLUMN_DEFS.map((def, i) => ({
  field:      `f${i}`,
  index:      i,
  label:      def.label,
  path:       def.path,
  duckType:   def.duckType,
  strandType: def.strandType,
}));

/** Lookup column by index (for worker → field name mapping) */
export const FIELD_NAMES: string[] = COLUMNS.map(c => c.field);

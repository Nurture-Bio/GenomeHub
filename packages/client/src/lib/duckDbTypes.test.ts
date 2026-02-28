import { describe, it, expect } from 'vitest';
import { isNumeric } from './duckDbTypes';

// ── Scalar types that MUST match ─────────────────────────
// DuckDB will accept MIN()/MAX() on all of these.

const SHOULD_MATCH = [
  'BIGINT',
  'UBIGINT',
  'HUGEINT',
  'INTEGER',
  'UINTEGER',
  'SMALLINT',
  'TINYINT',
  'DOUBLE',
  'FLOAT',
  'REAL',
  'DECIMAL',
  'DECIMAL(10, 2)',
  'DECIMAL(38,10)',
];

// ── Types that MUST NOT match ────────────────────────────
// Passing any of these to MIN()/MAX() causes DuckDB to throw,
// which aborts the entire fetchBounds query and leaves all
// sliders stuck on the skeleton loader forever.

const MUST_NOT_MATCH = [
  // Arrays — the original bug: BIGINT[] matched because the
  // regex found "BIGINT" as a substring.
  'BIGINT[]',
  'INTEGER[]',
  'DOUBLE[]',
  'FLOAT[]',
  'SMALLINT[]',

  // Maps containing numeric value types
  'MAP(VARCHAR, BIGINT)',
  'MAP(VARCHAR, INTEGER)',

  // Structs that contain numeric fields
  'STRUCT(x BIGINT, y DOUBLE)',
  'STRUCT(gc_content DOUBLE, off_targets BIGINT[])',

  // Non-numeric scalars
  'VARCHAR',
  'BOOLEAN',
  'DATE',
  'TIMESTAMP',
  'BLOB',
  'JSON',

  // Partial names that share a substring with valid types
  'UBIGINT_EXT',
  'MYINTEGER',
  'NOTADOUBLE',
];

describe('isNumeric', () => {
  it.each(SHOULD_MATCH)('accepts %s', type => {
    expect(isNumeric(type)).toBe(true);
  });

  it.each(MUST_NOT_MATCH)('rejects %s', type => {
    expect(isNumeric(type)).toBe(false);
  });
});

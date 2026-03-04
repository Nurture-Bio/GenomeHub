/**
 * Returns true only for plain scalar numeric DuckDB types.
 *
 * Anchored so compound types that contain a numeric name (BIGINT[], MAP(VARCHAR,
 * BIGINT), STRUCT(x BIGINT)) are correctly excluded — MIN()/MAX() would throw
 * on those, breaking fetchBounds for every column in the batch.
 *
 * DECIMAL optionally carries precision/scale: DECIMAL(10, 2).
 */
export function isNumeric(type: string): boolean {
  return /^(BIGINT|UBIGINT|HUGEINT|INTEGER|UINTEGER|SMALLINT|TINYINT|DOUBLE|FLOAT|REAL|DECIMAL(\(\d+,\s*\d+\))?)$/.test(
    type,
  );
}

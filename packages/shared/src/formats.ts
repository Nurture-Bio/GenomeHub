/**
 * File format detection — purely extension-based.
 * No hardcoded registry. The extension IS the format.
 */


/**
 * Extract the file format (extension) from a filename.
 * Strips .gz to get the meaningful extension underneath.
 * Returns 'other' only for files with no extension.
 */
export function detectFormat(filename: string): string {
  const lower = filename.toLowerCase();
  // Strip .gz to find the real extension
  const name = lower.endsWith('.gz') ? lower.slice(0, -3) : lower;
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1);
  return 'other';
}

/**
 * Formats that can be converted to Parquet sidecars by the server.
 * DuckDB reads these via read_json_auto or read_csv_auto.
 */
const CONVERTIBLE_FORMATS = new Set([
  'json', 'csv', 'tsv', 'bed', 'vcf', 'gff', 'gtf',
]);

/**
 * True when the file's format can be server-converted to a Parquet sidecar
 * for DuckDB WASM preview.
 */
export function isConvertible(filename: string): boolean {
  return CONVERTIBLE_FORMATS.has(detectFormat(filename));
}

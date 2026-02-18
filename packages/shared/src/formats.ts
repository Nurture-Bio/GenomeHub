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

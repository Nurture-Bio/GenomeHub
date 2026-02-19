/**
 * File format detection — purely extension-based.
 * No hardcoded registry. The extension IS the format.
 */

/**
 * Formats whose raw content is human-readable text (possibly gzipped).
 * Used by the preview endpoint to decide whether to offer a head preview.
 */
export const TEXT_PREVIEW_FORMATS = new Set([
  // Sequences
  'fastq', 'fq', 'fasta', 'fa', 'fna', 'ffn', 'faa',
  // Variants / regions
  'vcf', 'bed', 'bedgraph',
  // Annotation
  'gff', 'gff3', 'gtf',
  // Alignment (text form)
  'sam',
  // Tabular / general text
  'csv', 'tsv', 'txt', 'log', 'json', 'xml', 'html', 'yaml', 'yml', 'toml',
  // Count matrices
  'counts', 'mtx',
]);

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

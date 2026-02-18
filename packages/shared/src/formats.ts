/**
 * Canonical file format registry for GenomeHub.
 *
 * Single source of truth — consumed by both server and client.
 * Server uses id + extensions for detection.
 * Client adds CSS color tokens on top for display.
 */

export interface FormatEntry {
  /** Short machine-readable key (e.g. 'fastq', 'bam', 'h5ad') */
  id: string;
  /** Human label shown in UI (e.g. 'FASTQ', 'BAM') */
  label: string;
  /** File extensions including leading dot (e.g. ['.fastq', '.fastq.gz']) */
  extensions: string[];
  /** Foreground color — CSS var name or raw oklch value */
  color: string;
  /** Background color for icon swatch */
  bg: string;
  /** Brief description of the format */
  description: string;
}

/**
 * FORMAT_REGISTRY — ordered list of all recognized genomic formats.
 * 'other' must be last and serves as the fallback.
 */
export const FORMAT_REGISTRY: readonly FormatEntry[] = [
  // ── Sequencing reads ──────────────────────────────────
  { id: 'fastq',   label: 'FASTQ',    extensions: ['.fastq', '.fastq.gz', '.fq', '.fq.gz'],              color: 'oklch(0.68 0.18 145)', bg: 'oklch(0.18 0.02 145)', description: 'Raw reads' },
  { id: 'bam',     label: 'BAM',      extensions: ['.bam'],                                               color: 'oklch(0.68 0.16 250)', bg: 'oklch(0.18 0.02 250)', description: 'Aligned reads' },
  { id: 'cram',    label: 'CRAM',     extensions: ['.cram'],                                              color: 'oklch(0.68 0.16 250)', bg: 'oklch(0.18 0.02 250)', description: 'Compressed aligned reads' },
  { id: 'sam',     label: 'SAM',      extensions: ['.sam'],                                               color: 'oklch(0.68 0.16 250)', bg: 'oklch(0.18 0.02 250)', description: 'Text aligned reads' },

  // ── Variants ──────────────────────────────────────────
  { id: 'vcf',     label: 'VCF',      extensions: ['.vcf', '.vcf.gz'],                                    color: 'oklch(0.70 0.18 300)', bg: 'oklch(0.18 0.02 300)', description: 'Variant calls' },
  { id: 'bcf',     label: 'BCF',      extensions: ['.bcf'],                                               color: 'oklch(0.70 0.18 300)', bg: 'oklch(0.18 0.02 300)', description: 'Binary variant calls' },

  // ── Annotations & intervals ───────────────────────────
  { id: 'bed',     label: 'BED',      extensions: ['.bed', '.bed.gz'],                                    color: 'oklch(0.70 0.18 55)',  bg: 'oklch(0.18 0.02 55)',  description: 'Genomic intervals' },
  { id: 'gff',     label: 'GFF3',     extensions: ['.gff', '.gff3', '.gff.gz'],                           color: 'oklch(0.70 0.18 55)',  bg: 'oklch(0.18 0.02 55)',  description: 'Gene features' },
  { id: 'gtf',     label: 'GTF',      extensions: ['.gtf', '.gtf.gz'],                                    color: 'oklch(0.70 0.18 55)',  bg: 'oklch(0.18 0.02 55)',  description: 'Gene transfer format' },

  // ── Reference sequences ───────────────────────────────
  { id: 'fasta',   label: 'FASTA',    extensions: ['.fa', '.fasta', '.fa.gz', '.fasta.gz', '.fna', '.fna.gz'], color: 'oklch(0.70 0.18 168)', bg: 'oklch(0.18 0.02 168)', description: 'Reference sequence' },

  // ── Track files ───────────────────────────────────────
  { id: 'bigwig',  label: 'BigWig',   extensions: ['.bw', '.bigwig'],                                     color: 'oklch(0.70 0.18 168)', bg: 'oklch(0.18 0.02 168)', description: 'Coverage track' },
  { id: 'bigbed',  label: 'BigBed',   extensions: ['.bb', '.bigbed'],                                     color: 'oklch(0.70 0.18 168)', bg: 'oklch(0.18 0.02 168)', description: 'Interval track' },

  // ── Single-cell & matrix ──────────────────────────────
  { id: 'h5ad',    label: 'H5AD',     extensions: ['.h5ad'],                                              color: 'oklch(0.70 0.16 30)',  bg: 'oklch(0.18 0.02 30)',  description: 'AnnData (scanpy)' },
  { id: 'loom',    label: 'Loom',     extensions: ['.loom'],                                              color: 'oklch(0.70 0.16 30)',  bg: 'oklch(0.18 0.02 30)',  description: 'Loom single-cell matrix' },
  { id: 'mtx',     label: 'MTX',      extensions: ['.mtx', '.mtx.gz'],                                   color: 'oklch(0.70 0.16 30)',  bg: 'oklch(0.18 0.02 30)',  description: '10x sparse matrix' },

  // ── Hi-C / 3D genome ─────────────────────────────────
  { id: 'cool',    label: 'Cool',     extensions: ['.cool', '.mcool'],                                    color: 'oklch(0.70 0.16 200)', bg: 'oklch(0.18 0.02 200)', description: 'Hi-C contact matrix' },
  { id: 'pairs',   label: 'Pairs',    extensions: ['.pairs', '.pairs.gz'],                                color: 'oklch(0.70 0.16 200)', bg: 'oklch(0.18 0.02 200)', description: 'Hi-C pairs' },

  // ── General data ──────────────────────────────────────
  { id: 'h5',      label: 'HDF5',     extensions: ['.h5', '.hdf5'],                                      color: 'oklch(0.60 0.10 220)', bg: 'oklch(0.18 0.02 220)', description: 'HDF5 data container' },
  { id: 'zarr',    label: 'Zarr',     extensions: ['.zarr'],                                              color: 'oklch(0.60 0.10 220)', bg: 'oklch(0.18 0.02 220)', description: 'Zarr chunked array' },
  { id: 'parquet', label: 'Parquet',  extensions: ['.parquet', '.pq'],                                    color: 'oklch(0.60 0.10 220)', bg: 'oklch(0.18 0.02 220)', description: 'Columnar table' },

  // ── Fallback (must be last) ───────────────────────────
  { id: 'other',   label: 'FILE',     extensions: [],                                                     color: 'oklch(0.55 0 0)',      bg: 'oklch(0.18 0 0)',      description: 'Other file' },
] as const;

// Pre-built lookup maps (constructed once at import time)

const _byId = new Map<string, FormatEntry>();
for (const entry of FORMAT_REGISTRY) _byId.set(entry.id, entry);

const _fallback = _byId.get('other')!;

/**
 * Get format metadata by id. Returns the 'other' entry for unknown ids.
 */
export function getFormatMeta(id: string): FormatEntry {
  return _byId.get(id) ?? _fallback;
}

/**
 * Detect file format from a filename using extension matching.
 * Checks compound extensions first (e.g. '.fastq.gz' before '.gz').
 */
export function detectFormat(filename: string): string {
  const lower = filename.toLowerCase();
  for (const entry of FORMAT_REGISTRY) {
    if (entry.id === 'other') continue;
    if (entry.extensions.some(ext => lower.endsWith(ext))) return entry.id;
  }
  return 'other';
}

/**
 * Get all recognized file extensions as a flat array.
 * Useful for building file input accept attributes.
 */
export function getAllExtensions(): string[] {
  const exts: string[] = [];
  for (const entry of FORMAT_REGISTRY) {
    exts.push(...entry.extensions);
  }
  return exts;
}

/** All recognized format ids (including 'other'). */
export type FormatId = typeof FORMAT_REGISTRY[number]['id'];

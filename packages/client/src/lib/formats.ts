export type FileFormat =
  | 'fastq' | 'bam' | 'cram' | 'vcf' | 'bcf'
  | 'bed' | 'gff' | 'gtf' | 'fasta' | 'sam'
  | 'bigwig' | 'bigbed' | 'other';

export interface FormatMeta {
  label: string;
  ext:   string[];
  color: string;       // CSS var or color string
  bg:    string;       // surface bg for icon
  description: string;
}

export const FORMAT_META: Record<FileFormat, FormatMeta> = {
  fastq:  { label: 'FASTQ',   ext: ['.fastq', '.fastq.gz', '.fq', '.fq.gz'],       color: 'var(--color-fastq)',  bg: 'oklch(0.18 0.02 145)', description: 'Raw reads' },
  bam:    { label: 'BAM',     ext: ['.bam'],                                         color: 'var(--color-bam)',   bg: 'oklch(0.18 0.02 250)', description: 'Aligned reads' },
  cram:   { label: 'CRAM',    ext: ['.cram'],                                        color: 'var(--color-bam)',   bg: 'oklch(0.18 0.02 250)', description: 'Compressed aligned reads' },
  vcf:    { label: 'VCF',     ext: ['.vcf', '.vcf.gz'],                              color: 'var(--color-vcf)',   bg: 'oklch(0.18 0.02 300)', description: 'Variant calls' },
  bcf:    { label: 'BCF',     ext: ['.bcf'],                                         color: 'var(--color-vcf)',   bg: 'oklch(0.18 0.02 300)', description: 'Binary variant calls' },
  bed:    { label: 'BED',     ext: ['.bed', '.bed.gz'],                              color: 'var(--color-bed)',   bg: 'oklch(0.18 0.02 55)',  description: 'Genomic intervals' },
  gff:    { label: 'GFF3',    ext: ['.gff', '.gff3', '.gff.gz'],                     color: 'var(--color-bed)',   bg: 'oklch(0.18 0.02 55)',  description: 'Gene features' },
  gtf:    { label: 'GTF',     ext: ['.gtf', '.gtf.gz'],                              color: 'var(--color-bed)',   bg: 'oklch(0.18 0.02 55)',  description: 'Gene transfer format' },
  fasta:  { label: 'FASTA',   ext: ['.fa', '.fasta', '.fa.gz', '.fasta.gz'],         color: 'var(--color-fasta)', bg: 'oklch(0.18 0.02 168)', description: 'Reference sequence' },
  sam:    { label: 'SAM',     ext: ['.sam'],                                         color: 'var(--color-bam)',   bg: 'oklch(0.18 0.02 250)', description: 'Text aligned reads' },
  bigwig: { label: 'BigWig',  ext: ['.bw', '.bigwig'],                               color: 'var(--color-accent)',bg: 'oklch(0.18 0.02 168)', description: 'Coverage track' },
  bigbed: { label: 'BigBed',  ext: ['.bb', '.bigbed'],                               color: 'var(--color-accent)',bg: 'oklch(0.18 0.02 168)', description: 'Interval track' },
  other:  { label: 'FILE',    ext: [],                                               color: 'var(--color-text-dim)', bg: 'oklch(0.18 0 0)',   description: 'Other file' },
};

export function detectFormat(filename: string): FileFormat {
  const lower = filename.toLowerCase();
  for (const [fmt, meta] of Object.entries(FORMAT_META) as [FileFormat, FormatMeta][]) {
    if (fmt === 'other') continue;
    if (meta.ext.some(ext => lower.endsWith(ext))) return fmt;
  }
  return 'other';
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

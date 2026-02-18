/**
 * Client-side format utilities.
 *
 * Re-exports the canonical registry from @genome-hub/shared and adds
 * client-only helpers (CSS-variable color overrides, byte formatting, etc.).
 */

export {
  FORMAT_REGISTRY,
  detectFormat,
  getAllExtensions,
  getFormatMeta,
  type FormatEntry,
  type FormatId,
} from '@genome-hub/shared';

import { FORMAT_REGISTRY, type FormatEntry } from '@genome-hub/shared';

// ── Client-side display types ────────────────────────────

export type FileFormat = string;

export interface FormatMeta {
  label: string;
  ext:   string[];
  color: string;
  bg:    string;
  description: string;
}

/**
 * FORMAT_META — keyed lookup for backward compatibility with existing UI code.
 *
 * Client pages reference `FORMAT_META[format]` extensively, so we build this
 * once from the canonical registry. Colors use CSS custom properties when
 * available (overrides in index.css), falling back to the raw oklch values
 * from the registry for new formats.
 */

const CSS_VAR_OVERRIDES: Record<string, string> = {
  fastq:  'var(--color-fastq)',
  bam:    'var(--color-bam)',
  cram:   'var(--color-bam)',
  sam:    'var(--color-bam)',
  vcf:    'var(--color-vcf)',
  bcf:    'var(--color-vcf)',
  bed:    'var(--color-bed)',
  gff:    'var(--color-bed)',
  gtf:    'var(--color-bed)',
  fasta:  'var(--color-fasta)',
  bigwig: 'var(--color-accent)',
  bigbed: 'var(--color-accent)',
  other:  'var(--color-text-dim)',
};

function toMeta(entry: FormatEntry): FormatMeta {
  return {
    label:       entry.label,
    ext:         [...entry.extensions],
    color:       CSS_VAR_OVERRIDES[entry.id] ?? entry.color,
    bg:          entry.bg,
    description: entry.description,
  };
}

export const FORMAT_META: Record<string, FormatMeta> = Object.fromEntries(
  FORMAT_REGISTRY.map(e => [e.id, toMeta(e)])
);

// ── Client-only helpers ──────────────────────────────────

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

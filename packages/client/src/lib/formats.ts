/**
 * Client-side format utilities.
 * Format = file extension. Colors are deterministic from the extension string.
 */

export { detectFormat, isConvertible, isPileupFormat } from '@genome-hub/shared';

// ── Deterministic color from string ─────────────────────

import { hashColor } from './colors';

export interface FormatMeta {
  label: string;
  color: string;
  bg: string;
}

const _cache: Record<string, FormatMeta> = {};

/**
 * Get display metadata for a format id (file extension).
 * Colors via the canonical hashColor() — same as chips, filters, and badges.
 */
export function formatMeta(fmt: string): FormatMeta {
  if (_cache[fmt]) return _cache[fmt];
  const { color, bg } = hashColor(fmt);
  const meta: FormatMeta = {
    label: fmt === 'other' ? 'FILE' : fmt.toUpperCase(),
    color,
    bg,
  };
  _cache[fmt] = meta;
  return meta;
}

/**
 * FORMAT_META — Proxy that auto-generates entries on access.
 * Lets existing code keep using FORMAT_META[fmt] syntax.
 */
export const FORMAT_META: Record<string, FormatMeta> = new Proxy(_cache, {
  get(_target, prop: string) {
    return formatMeta(prop);
  },
});

// ── Formatting helpers ──────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

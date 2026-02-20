import type { CSSProperties } from 'react';
import { hashColor } from '../lib/colors';

interface HashPillProps {
  label: string;
  /** If provided, hash this string for the color instead of label. Useful for format codes. */
  colorKey?: string;
  className?: string;
}

/** A hash-colored pill for any label — format, type, organism, technique, collection. */
export default function HashPill({ label, colorKey, className }: HashPillProps) {
  const { bg, color } = hashColor(colorKey ?? label);
  return (
    <span
      className={['hash-chip', className].filter(Boolean).join(' ')}
      style={{ '--hc-bg': bg, '--hc-fg': color } as CSSProperties}
    >
      {label}
    </span>
  );
}

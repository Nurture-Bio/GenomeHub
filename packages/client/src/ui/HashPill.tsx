import type { CSSProperties, ReactNode } from 'react';
import { cx } from 'class-variance-authority';
import { hashColor } from '../lib/colors';

interface HashPillProps {
  label:      string;
  /** Hash this string for color instead of label. Useful for format codes. */
  colorKey?:  string;
  className?: string;
  onRemove?:  () => void;
  /** Override the label content (e.g. wrap in a Link). Falls back to label text. */
  children?:  ReactNode;
}

/** A hash-colored pill. Pass onRemove to get an inline × button. */
export default function HashPill({ label, colorKey, className, onRemove, children }: HashPillProps) {
  const { bg, color } = hashColor(colorKey ?? label);
  return (
    <span
      className={cx('hash-chip', onRemove && 'group/chip', className)}
      style={{ '--hc-bg': bg, '--hc-fg': color } as CSSProperties}
    >
      <span className="leading-none">{children ?? label}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="size-3.5 shrink-0 flex items-center justify-center rounded-full
                     opacity-0 group-hover/chip:opacity-100
                     transition-opacity duration-fast
                     text-current hover:bg-black/15
                     cursor-pointer border-0 bg-transparent leading-none"
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  );
}

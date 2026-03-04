import type { CSSProperties, ReactNode } from 'react';
import { cx } from 'class-variance-authority';
import { hashColor } from '../lib/colors';

interface HashChipProps {
  label: string;
  /** Hash this string for color instead of label. Useful for format codes. */
  colorKey?: string;
  className?: string;
  style?: CSSProperties;
  onRemove?: () => void;
  /** Makes the pill a clickable button. */
  onClick?: () => void;
  /** Override the label content (e.g. wrap in a Link). Falls back to label text. */
  children?: ReactNode;
}

/** A hash-colored pill. Pass onClick to render as a button. Pass onRemove for an inline × button. */
export default function HashChip({
  label,
  colorKey,
  className,
  style,
  onRemove,
  onClick,
  children,
}: HashChipProps) {
  const { bg, color } = hashColor(colorKey ?? label);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cx(
        'hash-chip border-[color:var(--hc-border,transparent)]',
        onClick &&
          [
            'cursor-pointer appearance-none',
            'transition-all duration-[382ms] [transition-timing-function:cubic-bezier(0.191,0,0.309,1)]',
            'hover:[transition-timing-function:cubic-bezier(0.382,0,0.618,1)]',
            'hover:[--hc-border:var(--color-cyan)] hover:[--hc-fg:var(--color-cyan)]',
            'hover:shadow-[0_0_2px_var(--color-cyan),inset_0_0_2px_var(--color-cyan)]',
            'active:shadow-[0_0_1px_var(--color-cyan),inset_0_0_1px_var(--color-cyan)]',
          ].join(' '),
        onRemove && 'group/chip',
        className,
      )}
      style={{ '--hc-bg': bg, '--hc-fg': color, ...style } as CSSProperties}
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
    </Tag>
  );
}

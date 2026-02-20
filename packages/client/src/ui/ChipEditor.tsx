import { useState, type ReactNode, type CSSProperties } from 'react';
import { chip, iconAction } from './recipes';
import type { ComboBoxItem } from './ComboBox';

/** Deterministic hue from a string — no library needed.
 *  Uses Knuth multiplicative hashing to spread similar strings (e.g. "gtf"
 *  vs "gbff") far apart on the hue wheel. */
function strHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  // Knuth multiplicative hash — scrambles adjacent values across the full range
  h = Math.imul(h >>> 0, 2654435761) >>> 0;
  return h % 360;
}

export function chipColorStyle(label: string): CSSProperties {
  const hue = strHue(label);
  return {
    backgroundColor: `hsl(${hue} 55% 88%)`,
    color:           `hsl(${hue} 55% 28%)`,
  };
}

export interface ChipItem {
  id: string;
  label: string;
}

export interface ChipEditorProps {
  items: ChipItem[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  renderPicker: (props: {
    value: string;
    onValueChange: (id: string) => void;
    items?: ComboBoxItem[];
  }) => ReactNode;
  size?: 'sm' | 'md';
  colored?: boolean;
  disabled?: boolean;
  maxVisible?: number;
  /** Render each chip label as a link */
  renderLabel?: (item: ChipItem) => ReactNode;
}

export default function ChipEditor({
  items, onAdd, onRemove, renderPicker,
  colored, disabled, maxVisible, renderLabel,
}: ChipEditorProps) {
  const [adding, setAdding] = useState(false);

  const visible = maxVisible && items.length > maxVisible
    ? items.slice(0, maxVisible)
    : items;
  const overflow = maxVisible && items.length > maxVisible
    ? items.length - maxVisible
    : 0;

  const handleAdd = (id: string) => {
    if (!id || items.some(i => i.id === id)) return;
    onAdd(id);
    setAdding(false);
  };

  return (
    <div className="flex gap-0.5 flex-wrap items-center">
      {visible.map(item => (
        <span key={item.id} className={chip()} style={colored ? chipColorStyle(item.label) : undefined}>
          {renderLabel ? renderLabel(item) : (
            <span>{item.label}</span>
          )}
          {!disabled && (
            <button
              className={iconAction({ color: 'dim' })}
              style={{ fontSize: 'var(--font-size-micro)' }}
              onClick={() => onRemove(item.id)}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span className={chip({ variant: 'subtle' })}>
          +{overflow} more
        </span>
      )}
      {!disabled && (
        adding ? (
          renderPicker({
            value: '',
            onValueChange: (v) => {
              if (v) handleAdd(v);
              else setAdding(false);
            },
          })
        ) : (
          <button
            className={iconAction({ color: 'dim' })}
            style={{ fontSize: 'var(--font-size-micro)' }}
            onClick={() => setAdding(true)}
          >
            +
          </button>
        )
      )}
    </div>
  );
}

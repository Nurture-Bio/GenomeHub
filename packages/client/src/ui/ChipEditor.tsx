import { type ReactNode, type CSSProperties } from 'react';
import type { ComboBoxItem } from './ComboBox';
import { hashColor } from '../lib/colors';

export function chipColorStyle(label: string): CSSProperties {
  const { bg, color } = hashColor(label);
  return { '--hc-bg': bg, '--hc-fg': color } as CSSProperties;
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
    trigger?: ReactNode;
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
  const visible = maxVisible && items.length > maxVisible
    ? items.slice(0, maxVisible)
    : items;
  const overflow = maxVisible && items.length > maxVisible
    ? items.length - maxVisible
    : 0;

  const handleAdd = (id: string) => {
    if (!id || items.some(i => i.id === id)) return;
    onAdd(id);
  };

  const addTrigger = (
    <button
      type="button"
      aria-label="Add"
      className="size-5 shrink-0 flex items-center justify-center rounded-full
                 opacity-0 group-hover/editor:opacity-100
                 transition-opacity duration-fast
                 bg-surface-2 text-text-dim hover:text-text hover:bg-surface-3
                 cursor-pointer border-0 font-body text-caption leading-none"
    >
      +
    </button>
  );

  return (
    <div className="group/editor flex gap-1 flex-wrap items-center">

      {visible.map(item => (
        <span
          key={item.id}
          className="group/chip hash-chip"
          style={colored ? chipColorStyle(item.label) : undefined}
        >
          {renderLabel ? renderLabel(item) : (
            <span className="leading-none">{item.label}</span>
          )}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${item.label}`}
              className="size-3.5 shrink-0 flex items-center justify-center rounded-full
                         opacity-0 group-hover/chip:opacity-100
                         transition-opacity duration-fast
                         text-current hover:bg-black/15
                         cursor-pointer border-0 bg-transparent leading-none"
              onClick={() => onRemove(item.id)}
            >
              ×
            </button>
          )}
        </span>
      ))}

      {overflow > 0 && (
        <span className="font-body text-caption text-text-dim px-1 leading-none">
          +{overflow} more
        </span>
      )}

      {!disabled && renderPicker({
        value: '',
        onValueChange: handleAdd,
        trigger: addTrigger,
      })}

    </div>
  );
}

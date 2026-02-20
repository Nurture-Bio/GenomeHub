import { useState, type ReactNode } from 'react';
import { chip, iconAction } from './recipes';
import type { ComboBoxItem } from './ComboBox';

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
  disabled?: boolean;
  maxVisible?: number;
  /** Render each chip label as a link */
  renderLabel?: (item: ChipItem) => ReactNode;
}

export default function ChipEditor({
  items, onAdd, onRemove, renderPicker,
  disabled, maxVisible, renderLabel,
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
        <span key={item.id} className={chip()}>
          {renderLabel ? renderLabel(item) : (
            <span className="text-text-secondary">{item.label}</span>
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

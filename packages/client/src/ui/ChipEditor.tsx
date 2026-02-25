import { type ReactNode } from 'react';
import HashPill from './HashPill';
import type { HashChipItem } from './HashChipPopover';

export interface ChipEditorProps {
  items:         HashChipItem[];
  onAdd:         (id: string) => void;
  onRemove:      (id: string) => void;
  renderPicker:  (props: {
    value:         string;
    onValueChange: (id: string) => void;
    trigger?:      ReactNode;
  }) => ReactNode;
  /** Override the label content inside a chip (e.g. to render a Link). */
  renderLabel?:  (item: HashChipItem) => ReactNode;
  disabled?:     boolean;
  maxVisible?:   number;
}

export default function ChipEditor({
  items, onAdd, onRemove, renderPicker, renderLabel, disabled, maxVisible,
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
                 bg-raised text-fg-3 hover:text-fg hover:bg-elevated
                 cursor-pointer border-0 font-sans text-body leading-none"
    >
      +
    </button>
  );

  return (
    <div className="group/editor flex gap-1 flex-wrap items-center">

      {visible.map(item => (
        <HashPill
          key={item.id}
          label={renderLabel ? '' : item.label}
          colorKey={item.label}
          onRemove={!disabled ? () => onRemove(item.id) : undefined}
        >
          {renderLabel ? renderLabel(item) : undefined}
        </HashPill>
      ))}

      {overflow > 0 && (
        <span className="font-sans text-body text-fg-3 px-1 leading-none">
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

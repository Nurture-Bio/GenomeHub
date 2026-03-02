import type { ReactNode } from 'react';
import HashChip from './HashChip';
import ComboBox, { type ComboBoxItem } from './ComboBox';

export interface HashChipItem {
  id:           string;
  label:        string;
  description?: string;
}

interface HashChipPopoverProps {
  items:        HashChipItem[];
  value?:       string;
  onSelect:     (id: string) => void;
  trigger?:     ReactNode;
  placeholder?: string;
  onCreate?:    (label: string) => void;
  disabled?:    boolean;
  loading?:     boolean;
  size?:        'sm' | 'md';
  variant?:     'default' | 'surface';
  className?:   string;
}

export default function HashChipPopover({
  items, value, onSelect, trigger, placeholder, onCreate, ...rest
}: HashChipPopoverProps) {
  const comboItems: ComboBoxItem[] = items.map(i => ({
    id:          i.id,
    label:       i.label,
    description: i.description,
    icon:        <HashChip label={i.label} />,
  }));

  return (
    <ComboBox
      {...rest}
      items={comboItems}
      value={value ?? ''}
      onValueChange={onSelect}
      trigger={trigger}
      placeholder={placeholder}
      onCreate={onCreate}
    />
  );
}

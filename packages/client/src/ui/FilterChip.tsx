import type { CSSProperties } from 'react';
import { hashColor } from '../lib/colors';
import ComboBox from './ComboBox';
import type { ComboBoxItem } from './ComboBox';
import HashPill from './HashPill';

export interface FilterChipItem {
  id: string;
  label: string;
}

interface FilterChipProps {
  label: string;
  items: FilterChipItem[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
}

export default function FilterChip({ label, items, value, onValueChange, className }: FilterChipProps) {
  const selected = items.find(i => i.id === value);
  const active = !!selected;
  const hc = active ? hashColor(selected!.label) : null;

  const comboItems: ComboBoxItem[] = items.map(i => ({
    id: i.id,
    label: i.label,
    icon: <HashPill label={i.label} />,
  }));

  return (
    <ComboBox
      items={comboItems}
      value={value}
      onValueChange={onValueChange}
      placeholder={label}
      trigger={
        <button
          className={['hash-filter-btn inline-flex items-center gap-0.5', className].filter(Boolean).join(' ')}
          data-active={active}
          style={hc ? { '--hc-bg': hc.bg, '--hc-fg': hc.color } as CSSProperties : undefined}
        >
          {selected?.label ?? label}
          <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 opacity-60">
            <path d="M2.5 4l2.5 2.5L7.5 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      }
    />
  );
}

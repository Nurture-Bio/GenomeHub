import HashPill from './HashPill';
import HashChipPopover, { type HashChipItem } from './HashChipPopover';

interface FilterChipProps {
  label:         string;
  items:         HashChipItem[];
  value:         string;
  onValueChange: (id: string) => void;
  className?:    string;
}

export default function FilterChip({ label, items, value, onValueChange, className }: FilterChipProps) {
  const selected = items.find(i => i.id === value);

  const trigger = (
    <button
      className={['hash-filter-btn inline-flex items-center gap-1', className].filter(Boolean).join(' ')}
      data-active={!!selected}
    >
      {selected ? <HashPill label={selected.label} /> : label}
      <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 opacity-60">
        <path d="M2.5 4l2.5 2.5L7.5 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  return (
    <HashChipPopover
      items={items}
      value={value}
      onSelect={onValueChange}
      trigger={trigger}
      placeholder={label}
    />
  );
}

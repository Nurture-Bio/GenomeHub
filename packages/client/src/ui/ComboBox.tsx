import { useState, useRef, useEffect } from 'react';
import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import { cx } from 'class-variance-authority';
import { input } from './recipes';

export interface ComboBoxItem {
  id: string;
  label: string;
  description?: string;
  group?: string;
  icon?: React.ReactNode;
}

export interface ComboBoxProps {
  items: ComboBoxItem[];
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  recentIds?: string[];
  size?: 'sm' | 'md';
  variant?: 'default' | 'surface';
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  onCreate?: (search: string) => void;
}

export default function ComboBox({
  items,
  value,
  onValueChange,
  placeholder = '...',
  emptyMessage = 'No results.',
  recentIds,
  size = 'md',
  variant = 'default',
  className,
  disabled,
  loading,
  onCreate,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = items.find(i => i.id === value);
  const hasExactMatch = items.some(i => i.label.toLowerCase() === search.toLowerCase());
  const showCreate = onCreate && search.trim() && !hasExactMatch;

  // Reset search when popover closes
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  // Group items: recent first, then by group
  const recentSet = new Set(recentIds ?? []);
  const recentItems = recentIds
    ? items.filter(i => recentSet.has(i.id) && i.id !== value)
    : [];
  const groups = new Map<string, ComboBoxItem[]>();
  for (const item of items) {
    const g = item.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          disabled={disabled}
          className={cx(
            input({ variant, size }),
            'flex items-center gap-1.5 text-left cursor-pointer',
            !selected && 'text-text-dim',
            disabled && 'opacity-50 cursor-not-allowed',
            className,
          )}
        >
          <span className="flex-1 min-w-0 truncate">
            {loading ? 'Loading...' : selected ? selected.label : placeholder}
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 text-text-dim">
            <path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className="bg-surface border border-border shadow-lg rounded-md overflow-hidden z-50 animate-fade-in"
          style={{ width: 'var(--radix-popover-trigger-width)', minWidth: 200, maxHeight: 300 }}
        >
          <Command shouldFilter={true}>
            <div className="border-b border-border-subtle px-2 py-1.5">
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Filter..."
                className="w-full bg-transparent border-none outline-none font-body text-caption text-text placeholder:text-text-dim"
              />
            </div>

            <Command.List className="overflow-y-auto max-h-56">
              <Command.Empty className="px-2 py-3 text-center text-caption text-text-dim font-body">
                {emptyMessage}
              </Command.Empty>

              {/* Clear selection option */}
              {value && (
                <Command.Item
                  value="__clear__"
                  onSelect={() => { onValueChange(''); setOpen(false); }}
                  className="px-2 py-1.5 text-caption text-text-dim font-body cursor-pointer hover:bg-surface-2 transition-colors duration-fast min-h-5.5 flex items-center"
                >
                  {placeholder}
                </Command.Item>
              )}

              {/* Recent selections */}
              {recentItems.length > 0 && (
                <Command.Group heading="Recent" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-overline [&_[cmdk-group-heading]]:text-text-dim">
                  {recentItems.map(item => (
                    <ComboBoxOption key={'recent-' + item.id} item={item} selected={false} onSelect={() => { onValueChange(item.id); setOpen(false); }} />
                  ))}
                </Command.Group>
              )}

              {/* Grouped or ungrouped items */}
              {groups.size <= 1 ? (
                items.map(item => (
                  <ComboBoxOption key={item.id} item={item} selected={item.id === value} onSelect={() => { onValueChange(item.id); setOpen(false); }} />
                ))
              ) : (
                Array.from(groups.entries()).map(([group, groupItems]) => (
                  <Command.Group key={group} heading={group || undefined} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-overline [&_[cmdk-group-heading]]:text-text-dim">
                    {groupItems.map(item => (
                      <ComboBoxOption key={item.id} item={item} selected={item.id === value} onSelect={() => { onValueChange(item.id); setOpen(false); }} />
                    ))}
                  </Command.Group>
                ))
              )}

              {/* Inline creation option */}
              {showCreate && (
                <Command.Item
                  value={`__create__${search}`}
                  onSelect={() => { onCreate(search.trim()); setOpen(false); setSearch(''); }}
                  className="px-2 py-1.5 text-caption font-body cursor-pointer hover:bg-surface-2 transition-colors duration-fast min-h-5.5 flex items-center gap-1 border-t border-border-subtle"
                  style={{ color: 'var(--color-accent)' }}
                >
                  + Create &ldquo;{search.trim()}&rdquo;
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ComboBoxOption({ item, selected, onSelect }: { item: ComboBoxItem; selected: boolean; onSelect: () => void }) {
  return (
    <Command.Item
      value={item.label}
      onSelect={onSelect}
      className={cx(
        'px-2 py-1.5 cursor-pointer transition-colors duration-fast min-h-5.5 flex items-center gap-2',
        selected ? 'bg-surface-2' : 'hover:bg-surface-2',
      )}
    >
      {item.icon}
      <div className="flex-1 min-w-0">
        <div className="font-body text-caption text-text truncate">{item.label}</div>
        {item.description && <div className="text-micro text-text-dim truncate">{item.description}</div>}
      </div>
      {selected && (
        <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-accent">
          <path d="M3 7l3 3 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Command.Item>
  );
}

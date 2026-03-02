import { useState, useEffect } from 'react';
import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';
import { cx } from 'class-variance-authority';
import { input, text } from './recipes';

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
  /** Render a custom trigger via Radix asChild instead of the default value button. */
  trigger?: React.ReactNode;
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
  trigger,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

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
  // Exclude recent items from the main list so cmdk never sees duplicate values
  const mainItems = recentItems.length > 0
    ? items.filter(i => !recentSet.has(i.id) || i.id === value)
    : items;
  const groups = new Map<string, ComboBoxItem[]>();
  for (const item of mainItems) {
    const g = item.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {trigger ? (
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      ) : (
        <Popover.Trigger asChild>
          <button
            disabled={disabled}
            className={cx(
              input({ variant, size }),
              'flex items-center gap-1.5 text-left cursor-pointer',
              !selected && 'text-fg-3',
              disabled && 'opacity-50 cursor-not-allowed',
              className,
            )}
          >
            <span className="flex-1 min-w-0">
              {loading ? 'Loading...' : selected ? (
                <>
                  <span className="block truncate">{selected.label}</span>
                  {selected.description && <span className="block truncate text-fg-3" style={{ fontSize: '0.85em' }}>{selected.description}</span>}
                </>
              ) : placeholder}
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 text-fg-3">
              <path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </Popover.Trigger>
      )}

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className="bg-base border border-line shadow-lg rounded-md overflow-hidden z-popover animate-fade-in flex flex-col"
          style={{ width: 'var(--radix-popover-trigger-width)', minWidth: 200, maxHeight: 300 }}
        >
          <Command shouldFilter={true} className="flex flex-col min-h-0 flex-1">
            <div className="border-b border-line px-2 py-1 shrink-0">
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Filter..."
                className={cx(text({ variant: 'body' }), 'w-full bg-transparent border-none outline-none text-body placeholder:text-fg-3')}
              />
            </div>

            <Command.List className="overflow-y-auto flex-1 min-h-0">
              <Command.Empty className={cx(text({ variant: 'dim' }), 'px-2 py-3 text-center')}>
                {emptyMessage}
              </Command.Empty>

              {/* Clear selection option */}
              {value && (
                <Command.Item
                  value="__clear__"
                  onSelect={() => { onValueChange(''); setOpen(false); }}
                  className={cx(text({ variant: 'dim' }), 'px-2 py-1 cursor-pointer hover:bg-raised transition-colors duration-fast flex items-center')}
                >
                  {placeholder}
                </Command.Item>
              )}

              {/* Recent selections */}
              {recentItems.length > 0 && (
                <Command.Group heading="Recent" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-body [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-overline [&_[cmdk-group-heading]]:text-fg-3">
                  {recentItems.map(item => (
                    <ComboBoxOption key={'recent-' + item.id} item={item} selected={false} onSelect={() => { onValueChange(item.id); setOpen(false); }} />
                  ))}
                </Command.Group>
              )}

              {/* Grouped or ungrouped items */}
              {groups.size <= 1 ? (
                mainItems.map(item => (
                  <ComboBoxOption key={item.id} item={item} selected={item.id === value} onSelect={() => { onValueChange(item.id); setOpen(false); }} />
                ))
              ) : (
                Array.from(groups.entries()).map(([group, groupItems]) => (
                  <Command.Group key={group} heading={group || undefined} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-body [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-overline [&_[cmdk-group-heading]]:text-fg-3">
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
                  className={cx(text({ variant: 'dim' }), 'px-2 py-1 cursor-pointer hover:bg-raised transition-colors duration-fast flex items-center gap-1 border-t border-line')}
                  style={{ color: 'var(--color-cyan)' }}
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

// Guard against double-fire from cmdk onSelect + native onClick
let _lastSelect = 0;
function fireOnce(fn: () => void) {
  const now = Date.now();
  if (now - _lastSelect < 100) return;
  _lastSelect = now;
  fn();
}

function ComboBoxOption({ item, selected, onSelect }: { item: ComboBoxItem; selected: boolean; onSelect: () => void }) {
  const handle = () => fireOnce(onSelect);
  return (
    <Command.Item
      value={item.label}
      onSelect={handle}
      onClick={handle}
      className={cx(
        'px-2 py-1 cursor-pointer transition-colors duration-fast flex items-center gap-2',
        selected ? 'bg-raised' : 'hover:bg-raised',
      )}
    >
      {item.icon}
      {(!item.icon || item.description) && (
        <div className="flex-1 min-w-0">
          {!item.icon && <div className={cx(text({ variant: 'body' }), 'text-body truncate')}>{item.label}</div>}
          {item.description && <div className={cx(text({ variant: 'dim' }), 'text-body truncate')}>{item.description}</div>}
        </div>
      )}
      {selected && (
        <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-cyan">
          <path d="M3 7l3 3 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Command.Item>
  );
}

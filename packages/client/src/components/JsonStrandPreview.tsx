/**
 * JsonStrandPreview — embedded JSON → Strand preview component.
 *
 * Layout and behaviour are identical to DevJsonPage:
 *   Left sidebar   FilterSidebar (range sliders + multi-select + text search)
 *   Right panel    Cursor-driven virtualizer — zero JS object allocation per row
 *
 * The only differences from DevJsonPage:
 *   • Takes a presigned `url` prop instead of the hardcoded /library.json path.
 *   • Uses useJsonStrand(url, 'auto') — schema is inferred via Phase 0.
 *   • Height is fixed at 560 px (embedded panel, not full viewport).
 *   • Header is a compact status row instead of a page heading.
 */

import { useRef, useMemo, useState, useCallback, useEffect, memo } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as Popover from '@radix-ui/react-popover';
import { Text, Badge } from '../ui';
import { useJsonStrand } from '../hooks/useJsonStrand';
import type { FieldDef } from '../workers/jsonStrandWorker';
import type { RecordCursor, FieldType, FilterPredicate, ConstrainedRanges } from '@strand/core';

// ── Constants ─────────────────────────────────────────────────────────────────

const NUMERIC_FIELD_TYPES = new Set<FieldType>(['i32', 'u32', 'f32', 'f64', 'u8', 'u16']);
const ROW_H   = 28;
const PANEL_H = 560;

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt(value: unknown, type: FieldType): string {
  if (value === null || value === undefined) return '';
  if (type === 'i64') return String(value as bigint);
  if (type === 'f32' || type === 'f64') return (value as number).toFixed(2);
  if (NUMERIC_FIELD_TYPES.has(type)) {
    const n = value as number;
    const a = Math.abs(n);
    if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (a >= 10_000)    return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }
  const s = String(value);
  return s.length > 32 ? s.slice(0, 30) + '…' : s;
}

function heatStyle(v: number, min: number, max: number): CSSProperties {
  if (min === max) return {};
  const t = (v - min) / (max - min);
  return { background: `oklch(0.750 0.180 195 / ${(t * 0.14).toFixed(3)})` };
}

function colW(type: FieldType): number {
  return (NUMERIC_FIELD_TYPES.has(type) || type === 'i64') ? 92 : 140;
}

// ── SortChevron ───────────────────────────────────────────────────────────────

function SortChevron({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{
      flexShrink: 0, transition: 'transform var(--t-fast) var(--ease-move)',
      transform: dir === 'desc' ? 'rotate(180deg)' : 'none',
      opacity: dir ? 1 : 0.3, color: dir ? 'var(--color-cyan)' : 'inherit',
    }}>
      <path d="M4 0L7.5 4.5H0.5L4 0Z" />
    </svg>
  );
}

// ── RangeSlider ───────────────────────────────────────────────────────────────

function RangeSlider({ name, min, max, low, high, onRangeChange, constrainedMin, constrainedMax, pending }: {
  name: string; min: number; max: number; low: number; high: number;
  onRangeChange:   (name: string, lo: number, hi: number) => void;
  constrainedMin?: number;
  constrainedMax?: number;
  pending?:        boolean;
}) {
  const [tooltip, setTooltip] = useState<'low' | 'high' | null>(null);

  const range   = max - min || 1;
  const lowPct  = ((low  - min) / range) * 100;
  const highPct = ((high - min) / range) * 100;
  const full    = low <= min && high >= max;
  const isFloat = !Number.isInteger(min) || !Number.isInteger(max);
  const step    = isFloat ? range / 200 : Math.max(1, Math.round(range / 200));

  const hasCon   = constrainedMin !== undefined && constrainedMax !== undefined;
  const conLoPct = hasCon ? Math.max(0,   ((constrainedMin! - min) / range) * 100) : 0;
  const conHiPct = hasCon ? Math.min(100, ((constrainedMax! - min) / range) * 100) : 0;
  const showCon  = hasCon && (conLoPct > 0.5 || conHiPct < 99.5);

  const epsilon = (max - min) * 0.001;
  const lowOob  = !pending && hasCon && low  < constrainedMin! - epsilon;
  const highOob = !pending && hasCon && high > constrainedMax! + epsilon;

  const AMBER_COLOR = 'var(--color-amber)';
  const AMBER_GLOW  = 'oklch(0.750 0.185 60 / 0.28)';
  const CYAN_GLOW   = 'oklch(0.750 0.180 195 / 0.25)';

  const lowThumbStyle  = {
    '--range-thumb-color': lowOob  ? AMBER_COLOR : 'var(--color-cyan)',
    '--range-thumb-glow':  lowOob  ? AMBER_GLOW  : CYAN_GLOW,
    zIndex: 3, opacity: lowOob  ? 0.80 : 1,
  } as CSSProperties;

  const highThumbStyle = {
    '--range-thumb-color': highOob ? AMBER_COLOR : 'var(--color-cyan)',
    '--range-thumb-glow':  highOob ? AMBER_GLOW  : CYAN_GLOW,
    zIndex: 4, opacity: highOob ? 0.80 : 1,
  } as CSSProperties;

  const handleClipToReality = () => {
    if (hasCon) onRangeChange(name, constrainedMin!, constrainedMax!);
  };

  return (
    <div>
      <div className="relative" style={{ height: 20 }}>
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full w-full"
          style={{ height: 2, background: 'var(--color-line)' }} />
        {showCon && (
          <div
            className="absolute top-1/2 -translate-y-1/2 rounded-full"
            title="Double-click to clip handles to this range"
            onDoubleClick={handleClipToReality}
            style={{
              left: `${conLoPct}%`, width: `${conHiPct - conLoPct}%`, height: 6,
              background: 'var(--color-cyan)',
              opacity: pending ? 0.10 : 0.20,
              cursor: 'pointer',
              transition: 'left 150ms ease, width 150ms ease, opacity var(--t-fast)',
            }}
          />
        )}
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${lowPct}%`, width: `${highPct - lowPct}%`, height: 2,
            background: 'var(--color-cyan)', opacity: full ? 0.25 : 1,
          }} />
        <input
          type="range"
          className="range-thumb range-low absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min} max={max} step={step} value={low}
          style={lowThumbStyle}
          onChange={e => onRangeChange(name, Math.min(Number(e.target.value), high), high)}
          onMouseEnter={() => lowOob  && setTooltip('low')}
          onMouseLeave={() => setTooltip(null)}
        />
        <input
          type="range"
          className="range-thumb range-high absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min} max={max} step={step} value={high}
          style={highThumbStyle}
          onChange={e => onRangeChange(name, low, Math.max(Number(e.target.value), low))}
          onMouseEnter={() => highOob && setTooltip('high')}
          onMouseLeave={() => setTooltip(null)}
        />
        {tooltip !== null && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)',
            left: `${tooltip === 'low' ? lowPct : highPct}%`,
            transform: 'translateX(-50%)',
            pointerEvents: 'none', whiteSpace: 'nowrap',
            background: 'var(--color-raised)', border: '1px solid var(--color-amber)',
            borderRadius: 4, padding: '3px 7px',
            fontSize: 'calc(var(--font-size-xs) - 1px)',
            color: 'var(--color-amber)', fontFamily: 'var(--font-mono)',
            boxShadow: '0 2px 8px oklch(0 0 0 / 0.4)', zIndex: 50,
          }}>
            No data in this region
          </div>
        )}
      </div>
      <div className="flex justify-between font-mono mt-0.5" style={{ fontSize: 'var(--font-size-xs)' }}>
        <span style={{ color: lowOob  ? 'var(--color-amber)' : full ? 'var(--color-fg-3)' : 'var(--color-fg-2)' }}>
          {isFloat ? low.toFixed(2) : low.toLocaleString()}
        </span>
        <span style={{ color: highOob ? 'var(--color-amber)' : full ? 'var(--color-fg-3)' : 'var(--color-fg-2)' }}>
          {isFloat ? high.toFixed(2) : high.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ── MultiSelect ───────────────────────────────────────────────────────────────

function MultiSelect({ values, selected, onToggle, onClear }: {
  values:   string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear:  () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = selected.size;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="w-full flex items-center justify-between gap-1.5 rounded-sm border border-line px-2 py-1 cursor-pointer bg-transparent hover:bg-raised transition-colors"
          style={{ fontSize: 'var(--font-size-xs)' }}
        >
          <span className="truncate" style={{ color: count > 0 ? 'var(--color-fg)' : 'var(--color-fg-3)' }}>
            {count > 0 ? `${count} of ${values.length}` : 'All'}
          </span>
          {count > 0
            ? <span className="shrink-0 rounded px-1 font-mono font-bold tabular-nums"
                style={{ fontSize: 'var(--font-size-xs)', background: 'var(--color-cyan)', color: 'var(--color-void)' }}>
                {count}
              </span>
            : <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0 opacity-40">
                <path d="M2 3l2 2 2-2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
          }
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={4} align="start"
          className="bg-base border border-line shadow-lg rounded-md z-popover animate-fade-in"
          style={{ minWidth: 190, maxHeight: 260, overflowY: 'auto' }}
        >
          {count > 0 && (
            <button
              className="block w-full text-left px-2 py-1.5 font-mono cursor-pointer bg-transparent border-none hover:bg-raised"
              style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)', borderBottom: '1px solid var(--color-line)' }}
              onClick={() => { onClear(); setOpen(false); }}
            >
              Clear selection
            </button>
          )}
          {values.map(v => (
            <label key={v}
              className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-raised"
              style={{ fontSize: 'var(--font-size-xs)' }}>
              <input type="checkbox"
                checked={selected.has(v)}
                onChange={() => onToggle(v)}
                style={{ accentColor: 'var(--color-cyan)', flexShrink: 0 }}
              />
              <span className="font-mono truncate"
                style={{ color: selected.has(v) ? 'var(--color-cyan)' : 'var(--color-fg)', fontWeight: selected.has(v) ? 600 : 400 }}>
                {v}
              </span>
            </label>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── FilterSidebar ─────────────────────────────────────────────────────────────

const FilterSidebar = memo(function FilterSidebar({
  fields, numericStats, cardinality,
  rangeState, selected, filters,
  onRangeChange, onToggleSelect, onClearSelect, onTextChange,
  hasAnyFilter, onClearAll,
  constrainedRanges, constrainedCount, totalRecords, noResults, pendingConstraints,
}: {
  fields:             FieldDef[];
  numericStats:       Record<string, { min: number; max: number }>;
  cardinality:        Record<string, string[]>;
  rangeState:         Record<string, [number, number]>;
  selected:           Record<string, Set<string>>;
  filters:            Record<string, string>;
  onRangeChange:      (name: string, lo: number, hi: number) => void;
  onToggleSelect:     (name: string, v: string) => void;
  onClearSelect:      (name: string) => void;
  onTextChange:       (name: string, v: string) => void;
  hasAnyFilter:       boolean;
  onClearAll:         () => void;
  constrainedRanges:  ConstrainedRanges;
  constrainedCount:   number;
  totalRecords:       number;
  noResults:          boolean;
  pendingConstraints: boolean;
}) {
  return (
    <div className="flex flex-col shrink-0 border-r border-line overflow-y-auto" style={{ width: 216 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-line shrink-0"
        style={{ background: 'var(--color-raised)' }}>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold" style={{
            fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-2)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Filters
          </span>
          {hasAnyFilter && totalRecords > 0 && (
            <span className="font-mono tabular-nums"
              style={{
                fontSize: 'calc(var(--font-size-xs) - 1px)',
                color: noResults ? 'oklch(0.650 0.180 30)' : 'var(--color-cyan)',
                opacity: pendingConstraints ? 0.5 : 1,
                transition: 'color var(--t-fast), opacity var(--t-fast)',
              }}>
              {constrainedCount.toLocaleString()}/{totalRecords.toLocaleString()}
            </span>
          )}
        </div>
        {hasAnyFilter && (
          <button onClick={onClearAll}
            className="cursor-pointer bg-transparent border-none transition-colors hover:text-fg"
            style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)' }}>
            Clear all
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 p-3"
        style={{ opacity: noResults ? 0.35 : 1, transition: 'opacity var(--t-fast)' }}>
        {fields.map(f => {
          const isNum  = NUMERIC_FIELD_TYPES.has(f.type);
          const stats  = numericStats[f.name];
          const card   = cardinality[f.name];
          const sel    = selected[f.name] ?? new Set<string>();
          const active = isNum
            ? !!filters[f.name]?.trim()
            : f.type === 'utf8_ref'
              ? sel.size > 0
              : !!filters[f.name]?.trim();

          return (
            <div key={f.name}>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="font-semibold" style={{
                  fontSize: 'var(--font-size-xs)',
                  color: active ? 'var(--color-cyan)' : 'var(--color-fg-2)',
                }}>
                  {f.name}
                </span>
                <span className="font-mono shrink-0" style={{ fontSize: 'calc(var(--font-size-xs) - 1px)', opacity: 0.35 }}>
                  {f.type}
                </span>
              </div>

              {isNum && stats ? (
                <RangeSlider
                  name={f.name}
                  min={stats.min} max={stats.max}
                  low={rangeState[f.name]?.[0]  ?? stats.min}
                  high={rangeState[f.name]?.[1] ?? stats.max}
                  constrainedMin={hasAnyFilter ? constrainedRanges[f.name]?.min : undefined}
                  constrainedMax={hasAnyFilter ? constrainedRanges[f.name]?.max : undefined}
                  pending={pendingConstraints}
                  onRangeChange={onRangeChange}
                />
              ) : isNum ? (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)', fontStyle: 'italic' }}>
                  Loading…
                </span>
              ) : f.type === 'utf8_ref' && card ? (
                card.length === 1 ? (
                  <span className="font-mono" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)', fontStyle: 'italic' }}>
                    {card[0]} (constant)
                  </span>
                ) : (
                  <MultiSelect
                    values={card}
                    selected={sel}
                    onToggle={v => onToggleSelect(f.name, v)}
                    onClear={() => onClearSelect(f.name)}
                  />
                )
              ) : f.type === 'utf8' ? (
                <input
                  className="w-full bg-transparent border border-line rounded-sm text-fg-2 font-mono placeholder:text-fg-3 focus:outline-none"
                  style={{
                    fontSize: 'var(--font-size-xs)', padding: '3px 6px',
                    borderColor: filters[f.name]?.trim() ? 'var(--color-cyan)' : undefined,
                    transition: 'border-color var(--t-fast)',
                  }}
                  placeholder="Search…"
                  value={filters[f.name] ?? ''}
                  onChange={e => onTextChange(f.name, e.target.value)}
                  spellCheck={false}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── VirtualRows ───────────────────────────────────────────────────────────────

const VirtualRows = memo(function VirtualRows({
  scrollRef, displayIndices, cursor, fields, numericStats, colWidths, totalWidth,
}: {
  scrollRef:      RefObject<HTMLDivElement | null>;
  displayIndices: number[];
  cursor:         RecordCursor;
  fields:         FieldDef[];
  numericStats:   Record<string, { min: number; max: number }>;
  colWidths:      Record<string, number>;
  totalWidth:     number;
}) {
  const virtualizer = useVirtualizer({
    count:            displayIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize:     () => ROW_H,
    overscan:         40,
  });

  return (
    <>
      <div style={{ height: virtualizer.getTotalSize(), width: totalWidth }} />
      <div style={{ position: 'relative', width: totalWidth, marginTop: -virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(vRow => {
          const seq = displayIndices[vRow.index]!;
          cursor.seek(seq);

          return (
            <div key={vRow.key} className="flex"
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H,
                transform: `translateY(${vRow.start}px)`,
                background: vRow.index % 2 === 1 ? 'oklch(0.120 0.020 250 / 0.3)' : undefined,
              }}
            >
              {fields.map(f => {
                const w      = colWidths[f.name] ?? colW(f.type);
                const isNum  = NUMERIC_FIELD_TYPES.has(f.type);
                const stats  = isNum ? numericStats[f.name] : undefined;
                const raw    = cursor.get(f.name);
                const numVal = isNum ? (raw as number ?? NaN) : NaN;

                return (
                  <div key={f.name} style={{
                    width: w, minWidth: 50, flexShrink: 0,
                    padding: '0 6px',
                    borderBottom: '1px solid var(--color-line)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textAlign: isNum ? 'right' : 'left',
                    fontVariantNumeric: isNum ? 'tabular-nums' : undefined,
                    lineHeight: `${ROW_H}px`,
                    fontSize: 'var(--font-size-xs)',
                    fontFamily: 'var(--font-mono)',
                    ...(stats && !isNaN(numVal) ? heatStyle(numVal, stats.min, stats.max) : {}),
                  }}>
                    {raw === null || raw === undefined
                      ? <span style={{ color: 'var(--color-fg-3)', fontStyle: 'italic' }}>—</span>
                      : fmt(raw, f.type)
                    }
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
});

// ── JsonStrandPreview ─────────────────────────────────────────────────────────

export default function JsonStrandPreview({ url }: { url: string }) {
  const {
    status, totalRecords, filteredIndices,
    cursor, numericStats, cardinality, internTable, fields,
    error, filters, debFilters, onFilterChange,
    constrainedRanges, constrainedCount, onConstraintRequest,
  } = useJsonStrand(url, 'auto');

  const scrollRef   = useRef<HTMLDivElement>(null);
  const headerRef   = useRef<HTMLDivElement>(null);
  const rangeDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizingRef = useRef<{ name: string; startX: number; startW: number } | null>(null);

  const [colWidths,          setColWidths]          = useState<Record<string, number>>({});
  const [rangeState,         setRangeState]         = useState<Record<string, [number, number]>>({});
  const [selected,           setSelected]           = useState<Record<string, Set<string>>>({});
  const [sort,               setSort]               = useState<{ name: string; dir: 'asc' | 'desc' } | null>(null);
  const [pendingConstraints, setPendingConstraints] = useState(false);

  // ── Stage 1 sort ──────────────────────────────────────────────────────────

  const sortedIndices = useMemo(() => {
    if (!sort || !cursor) return filteredIndices;
    const f = fields.find(fd => fd.name === sort.name);
    if (!f) return filteredIndices;

    const vals = new Map<number, unknown>();
    for (const seq of filteredIndices) {
      cursor.seek(seq);
      vals.set(seq, cursor.get(f.name));
    }

    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filteredIndices].sort((a, b) => {
      const av = vals.get(a);
      const bv = vals.get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'bigint' && typeof bv === 'bigint') return av < bv ? -dir : av > bv ? dir : 0;
      if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    });
  }, [filteredIndices, sort, cursor, fields]);

  // ── Stage 2 multi-select filter ───────────────────────────────────────────

  const displayIndices = useMemo(() => {
    const active = Object.entries(selected).filter(([, s]) => s.size > 0);
    if (active.length === 0 || !cursor) return sortedIndices;

    const out: number[] = [];
    for (const seq of sortedIndices) {
      cursor.seek(seq);
      let pass = true;
      for (const [name, set] of active) {
        if (!set.has(cursor.getRef(name) ?? '')) { pass = false; break; }
      }
      if (pass) out.push(seq);
    }
    return out;
  }, [sortedIndices, selected, cursor]);

  // ── Filter handlers ───────────────────────────────────────────────────────

  const handleRangeChange = useCallback((name: string, lo: number, hi: number) => {
    const stats = numericStats[name];
    setRangeState(prev => ({ ...prev, [name]: [lo, hi] }));
    if (!stats) return;
    if (rangeDebRef.current) clearTimeout(rangeDebRef.current);
    rangeDebRef.current = setTimeout(() => {
      onFilterChange(name, lo <= stats.min && hi >= stats.max ? '' : `BETWEEN ${lo} AND ${hi}`);
    }, 120);
  }, [numericStats, onFilterChange]);

  const handleTextChange   = useCallback((name: string, value: string) => onFilterChange(name, value), [onFilterChange]);
  const handleToggleSelect = useCallback((name: string, value: string) => {
    setSelected(prev => {
      const set = new Set(prev[name] ?? []);
      if (set.has(value)) set.delete(value); else set.add(value);
      if (set.size === 0) { const next = { ...prev }; delete next[name]; return next; }
      return { ...prev, [name]: set };
    });
  }, []);
  const handleClearSelect = useCallback((name: string) => {
    setSelected(prev => { const next = { ...prev }; delete next[name]; return next; });
  }, []);
  const handleClearAll = useCallback(() => {
    for (const f of fields) onFilterChange(f.name, '');
    setSelected({});
    setRangeState({});
  }, [fields, onFilterChange]);

  // Init range state from stats
  useEffect(() => {
    const init: Record<string, [number, number]> = {};
    for (const f of fields) {
      if (!NUMERIC_FIELD_TYPES.has(f.type)) continue;
      const s = numericStats[f.name];
      if (s && !rangeState[f.name]) init[f.name] = [s.min, s.max];
    }
    if (Object.keys(init).length > 0) setRangeState(prev => ({ ...init, ...prev }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericStats]);

  useEffect(() => () => { if (rangeDebRef.current) clearTimeout(rangeDebRef.current); }, []);

  // ── Constraint request ────────────────────────────────────────────────────

  useEffect(() => {
    if (status !== 'ready' && status !== 'streaming') return;

    const predicates: { field: string; predicate: FilterPredicate }[] = [];
    const fieldMap = new Map(fields.map(f => [f.name, f]));

    for (const [name, raw] of Object.entries(debFilters)) {
      const f = fieldMap.get(name);
      if (!f || !NUMERIC_FIELD_TYPES.has(f.type)) continue;
      const bm = raw.trim().match(/^BETWEEN\s+([\d.e+\-]+)\s+AND\s+([\d.e+\-]+)$/i);
      if (bm) predicates.push({ field: name, predicate: { kind: 'between', lo: Number(bm[1]), hi: Number(bm[2]) } });
    }

    for (const [name, set] of Object.entries(selected)) {
      if (set.size === 0) continue;
      const handles = new Set<number>();
      for (const v of set) {
        const idx = internTable.indexOf(v);
        if (idx !== -1) handles.add(idx);
      }
      if (handles.size > 0) predicates.push({ field: name, predicate: { kind: 'in', handles } });
    }

    setPendingConstraints(true);
    onConstraintRequest(predicates);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debFilters, selected, status, internTable, onConstraintRequest]);

  useEffect(() => { setPendingConstraints(false); }, [constrainedRanges]);

  // ── Sort ──────────────────────────────────────────────────────────────────

  const handleSortClick = useCallback((name: string) => {
    setSort(prev => {
      if (!prev || prev.name !== name) return { name, dir: 'asc' };
      if (prev.dir === 'asc') return { name, dir: 'desc' };
      return null;
    });
  }, []);

  // ── Column resize ─────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((name: string, startX: number, startW: number) => {
    resizingRef.current = { name, startX, startW };
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      setColWidths(prev => ({
        ...prev,
        [resizingRef.current!.name]: Math.max(50, resizingRef.current!.startW + e.clientX - resizingRef.current!.startX),
      }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const totalWidth   = fields.reduce((s, f) => s + (colWidths[f.name] ?? colW(f.type)), 0);
  const hasAnyFilter = Object.values(filters).some(v => v.trim()) || Object.keys(selected).length > 0;
  const isStreaming  = status === 'streaming' || status === 'scanning';
  const displayCount = displayIndices.length;
  const isFiltered   = hasAnyFilter && displayCount < totalRecords;
  const noResults    = hasAnyFilter && constrainedCount === 0 && status === 'ready';

  // ── Loading / error states ────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center py-8">
        <Text variant="dim" style={{ color: 'var(--color-red)' }}>{error}</Text>
      </div>
    );
  }

  if (status === 'init' || status === 'inferring' || status === 'scanning') {
    const label = status === 'inferring' ? 'Inferring schema…'
                : status === 'scanning'  ? 'Scanning JSON…'
                :                         'Initializing…';
    return (
      <div className="flex flex-col items-center justify-center gap-2"
        style={{ height: PANEL_H, background: 'var(--color-void)' }}>
        <div className="h-0.5 w-32 rounded-full overflow-hidden" style={{ background: 'var(--color-raised)' }}>
          <div className="h-full w-full progress-stripe" style={{ background: 'var(--color-cyan)' }} />
        </div>
        <Text variant="dim">{label}</Text>
      </div>
    );
  }

  // ── Main layout ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ background: 'var(--color-void)', height: PANEL_H }}>

      {/* Compact status bar */}
      <div className="px-3 py-1.5 border-b border-line flex items-center gap-2 flex-wrap shrink-0"
        style={{ background: 'var(--color-base)' }}>
        <Text variant="dim">{totalRecords.toLocaleString()} records</Text>
        {isStreaming && <Badge variant="count" color="dim">streaming</Badge>}
        {isFiltered && (
          <Badge variant="count" color="dim">
            {displayCount.toLocaleString()} / {totalRecords.toLocaleString()} shown
          </Badge>
        )}
      </div>

      {/* Body: sidebar + table */}
      <div className="flex flex-row flex-1 overflow-hidden">

        <FilterSidebar
          fields={fields}
          numericStats={numericStats}
          cardinality={cardinality}
          rangeState={rangeState}
          selected={selected}
          filters={filters}
          onRangeChange={handleRangeChange}
          onToggleSelect={handleToggleSelect}
          onClearSelect={handleClearSelect}
          onTextChange={handleTextChange}
          hasAnyFilter={hasAnyFilter}
          onClearAll={handleClearAll}
          constrainedRanges={constrainedRanges}
          constrainedCount={constrainedCount}
          totalRecords={totalRecords}
          noResults={noResults}
          pendingConstraints={pendingConstraints}
        />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Pinned column header */}
          <div ref={headerRef} className="shrink-0 overflow-hidden font-mono" style={{ width: totalWidth }}>
            <div className="flex">
              {fields.map(f => {
                const w       = colWidths[f.name] ?? colW(f.type);
                const sortDir = sort?.name === f.name ? sort.dir : null;
                return (
                  <div key={f.name}
                    className="text-left font-semibold text-fg-2 select-none relative group cursor-pointer"
                    style={{
                      width: w, minWidth: 50, flexShrink: 0, padding: '3px 6px',
                      background: 'var(--color-raised)',
                      borderBottom: `2px solid ${sortDir ? 'var(--color-cyan)' : 'var(--color-line)'}`,
                      whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)',
                    }}
                    onClick={() => handleSortClick(f.name)}
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate">{f.name}</span>
                      <SortChevron dir={sortDir} />
                    </div>
                    <span style={{ fontSize: 'calc(var(--font-size-xs) - 1px)', opacity: 0.35 }}>{f.type}</span>
                    <div
                      className="absolute top-0 right-0 bottom-0 opacity-0 group-hover:opacity-100"
                      style={{ width: 3, cursor: 'col-resize', background: 'var(--color-line)', transition: 'opacity var(--t-fast)' }}
                      onMouseDown={e => { e.stopPropagation(); handleResizeStart(f.name, e.clientX, w); }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-cyan)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-line)'; }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scrollable body */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto"
            onScroll={() => {
              if (headerRef.current && scrollRef.current)
                headerRef.current.scrollLeft = scrollRef.current.scrollLeft;
            }}
          >
            {cursor && displayIndices.length > 0 && (
              <VirtualRows
                scrollRef={scrollRef}
                displayIndices={displayIndices}
                cursor={cursor}
                fields={fields}
                numericStats={numericStats}
                colWidths={colWidths}
                totalWidth={totalWidth}
              />
            )}

            {displayIndices.length === 0 && status === 'ready' && (
              <div className="flex flex-col items-center justify-center gap-3" style={{ height: '100%', minHeight: 200 }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  style={{ opacity: 0.3, color: 'var(--color-fg-3)' }}>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
                <Text variant="dim">No records match the current filters</Text>
                <button
                  onClick={handleClearAll}
                  className="cursor-pointer bg-transparent border-none transition-colors hover:text-fg"
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)' }}
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

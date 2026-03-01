/**
 * ParquetPreview — DuckDB WASM over Parquet with windowed row fetching.
 *
 * UI reuses filter sidebar + virtualizer patterns from the preview component family.
 * Data layer: rows come from fetchWindow() → Map cache, not a SAB cursor.
 */

import { useRef, useMemo, useState, useCallback, useEffect, memo } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as Popover from '@radix-ui/react-popover';
import { Text } from '../ui';
import { useParquetPreview, isNumericType, DROPDOWN_MAX } from '../hooks/useParquetPreview';
import { useDataProfile } from '../hooks/useDataProfile';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../stores/useAppStore';
import type { ColumnInfo, ColumnStats, ColumnCardinality, FilterSpec, FilterOp, SortSpec, ProfileStatus, WasmStatus } from '../hooks/useParquetPreview';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROW_H       = 28;
const PANEL_H     = 560;
const SIDEBAR_W   = 216;
const PX_PER_CHAR = 7.5;
const MIN_COL_W   = 50;
const MAX_COL_W   = 300;
const COL_PADDING = 20;
const WINDOW_SIZE = 200;  // rows per fetch window

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt(value: unknown, type: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (!type) return String(value);
  const base = type.replace(/\(.+\)/, '').trim().toUpperCase();
  if (base === 'FLOAT' || base === 'DOUBLE' || base === 'DECIMAL') {
    return (value as number).toFixed(2);
  }
  if (isNumericType(type)) {
    const n = value as number;
    const a = Math.abs(n);
    if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (a >= 10_000)    return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return s.length > 32 ? s.slice(0, 30) + '…' : s;
}

function heatStyle(v: number, min: number, max: number): CSSProperties {
  if (min === max) return {};
  const t = (v - min) / (max - min);
  return { background: `oklch(0.750 0.180 195 / ${(t * 0.14).toFixed(3)})` };
}

function colW(type: string): number {
  return isNumericType(type) ? 92 : 140;
}

function colWFromName(name: string, type: string, maxCharLen?: number): number {
  const headerChars = Math.max(8, name.length);
  const dataChars = maxCharLen ?? headerChars;
  const chars = Math.max(headerChars, dataChars);
  const px    = Math.round(chars * PX_PER_CHAR) + COL_PADDING;
  return Math.min(MAX_COL_W, Math.max(MIN_COL_W, px));
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

// ── PipelineStatus — verbose loading indicator for biologists ─────────────────

const PIPELINE_STEPS = [
  { key: 'profile',  label: 'Reading schema' },
  { key: 'boot',     label: 'Starting engine' },
  { key: 'register', label: 'Opening dataset' },
  { key: 'query',    label: 'Drawing rows' },
  { key: 'ready',    label: 'Ready' },
] as const;

function pipelineIndex(profileStatus: ProfileStatus, wasmStatus: WasmStatus, isQuerying: boolean, hasData: boolean): number {
  if (profileStatus === 'polling' || profileStatus === 'error') return 0;
  if (wasmStatus === 'idle' || wasmStatus === 'booting') return 1;
  if (wasmStatus === 'registering') return 2;
  if (hasData) return 4; // ready
  return 3; // drawing rows
}

function PipelineStatus({ profileStatus, wasmStatus, isQuerying, hasData }: {
  profileStatus: ProfileStatus;
  wasmStatus: WasmStatus;
  isQuerying: boolean;
  hasData: boolean;
}) {
  const active = pipelineIndex(profileStatus, wasmStatus, isQuerying, hasData);
  return (
    <div className="flex flex-col items-center gap-2" style={{ opacity: 0.6 }}>
      <div className="flex items-center gap-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)' }}>
        {PIPELINE_STEPS.map((step, i) => {
          const reached = i <= active;
          const current = i === active;
          return (
            <span key={step.key} className="flex items-center gap-1">
              {i > 0 && <span style={{
                color: reached ? 'var(--color-cyan)' : 'var(--color-line)',
                transition: 'color var(--t-phi) var(--ease-phi)',
              }}>{'—'}</span>}
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: reached ? 'var(--color-cyan)' : 'var(--color-line)',
                boxShadow: current && i < PIPELINE_STEPS.length - 1 ? '0 0 6px var(--color-cyan)' : 'none',
                animation: current && i < PIPELINE_STEPS.length - 1 ? 'pulse 1.5s ease-in-out infinite' : 'none',
                transition: 'background var(--t-phi) var(--ease-phi), box-shadow var(--t-phi) var(--ease-phi)',
              }} />
            </span>
          );
        })}
      </div>
      <Text variant="dim" style={{ fontSize: 'var(--font-size-xs)' }}>
        {PIPELINE_STEPS[active].label}
      </Text>
    </div>
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

// ── InlineSelect ──────────────────────────────────────────────────────────────

function InlineSelect({ values, selected, onToggle }: {
  values:   string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map(v => {
        const on = selected.has(v);
        return (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className="font-mono cursor-pointer border rounded-sm px-1.5 py-0.5 transition-colors"
            style={{
              fontSize: 'var(--font-size-xs)',
              background:   on ? 'var(--color-cyan)'   : 'transparent',
              color:        on ? 'var(--color-void)'   : 'var(--color-fg-2)',
              borderColor:  on ? 'var(--color-cyan)'   : 'var(--color-line)',
              fontWeight:   on ? 600 : 400,
            }}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

// ── FilterSidebar ─────────────────────────────────────────────────────────────

const FilterSidebar = memo(function FilterSidebar({
  columns, columnStats, columnCardinality,
  rangeState, selected, textFilters,
  onRangeChange, onToggleSelect, onClearSelect, onTextChange,
  hasAnyFilter,
  constrainedStats, noResults, pendingConstraints,
}: {
  columns:             ColumnInfo[];
  columnStats:         Record<string, ColumnStats>;
  columnCardinality:   Record<string, ColumnCardinality>;
  rangeState:          Record<string, [number, number]>;
  selected:            Record<string, Set<string>>;
  textFilters:         Record<string, string>;
  onRangeChange:       (name: string, lo: number, hi: number) => void;
  onToggleSelect:      (name: string, v: string) => void;
  onClearSelect:       (name: string) => void;
  onTextChange:        (name: string, v: string) => void;
  hasAnyFilter:        boolean;
  constrainedStats:    Record<string, ColumnStats>;
  noResults:           boolean;
  pendingConstraints:  boolean;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-4 p-3"
        style={{ opacity: noResults ? 0.35 : 1, transition: 'opacity var(--t-fast)' }}>
        {columns.map(c => {
          const isNum  = isNumericType(c.type);
          const stats  = columnStats[c.name];
          const card   = columnCardinality[c.name];
          const sel    = selected[c.name] ?? new Set<string>();
          const hasCard = card && card.distinct >= 1 && card.distinct <= DROPDOWN_MAX;
          const active = isNum
            ? !!(rangeState[c.name] && stats && (rangeState[c.name][0] > stats.min || rangeState[c.name][1] < stats.max))
            : hasCard
              ? sel.size > 0
              : !!textFilters[c.name]?.trim();

          return (
            <div key={c.name}>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="font-semibold" style={{
                  fontSize: 'var(--font-size-xs)',
                  color: active ? 'var(--color-cyan)' : 'var(--color-fg-2)',
                }}>
                  {c.name}
                </span>
                <span className="font-mono shrink-0" style={{ fontSize: 'calc(var(--font-size-xs) - 1px)', opacity: 0.35 }}>
                  {c.type}
                </span>
              </div>

              {isNum && stats ? (
                stats.min === stats.max ? (
                  <span className="font-mono" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)', fontStyle: 'italic' }}>
                    {Number.isInteger(stats.min) ? stats.min.toLocaleString() : stats.min.toFixed(2)} (constant)
                  </span>
                ) : (
                  <RangeSlider
                    name={c.name}
                    min={stats.min} max={stats.max}
                    low={rangeState[c.name]?.[0]  ?? stats.min}
                    high={rangeState[c.name]?.[1] ?? stats.max}
                    constrainedMin={hasAnyFilter ? constrainedStats[c.name]?.min : undefined}
                    constrainedMax={hasAnyFilter ? constrainedStats[c.name]?.max : undefined}
                    pending={pendingConstraints}
                    onRangeChange={onRangeChange}
                  />
                )
              ) : hasCard ? (
                card.values.length === 1 ? (
                  <span className="font-mono" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)', fontStyle: 'italic' }}>
                    {card.values[0]} (constant)
                  </span>
                ) : card.values.length <= 5 ? (
                  <InlineSelect
                    values={card.values}
                    selected={sel}
                    onToggle={v => onToggleSelect(c.name, v)}
                  />
                ) : (
                  <MultiSelect
                    values={card.values}
                    selected={sel}
                    onToggle={v => onToggleSelect(c.name, v)}
                    onClear={() => onClearSelect(c.name)}
                  />
                )
              ) : !isNum ? (
                <input
                  className="w-full bg-transparent border border-line rounded-sm text-fg-2 font-mono placeholder:text-fg-3 focus:outline-none"
                  style={{
                    fontSize: 'var(--font-size-xs)', padding: '3px 6px',
                    borderColor: textFilters[c.name]?.trim() ? 'var(--color-cyan)' : undefined,
                    transition: 'border-color var(--t-fast)',
                  }}
                  placeholder="Search…"
                  value={textFilters[c.name] ?? ''}
                  onChange={e => onTextChange(c.name, e.target.value)}
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
  scrollRef, rowCount, fetchWindow, columns, columnStats, colWidths, totalWidth, onFirstData,
}: {
  scrollRef:   RefObject<HTMLDivElement | null>;
  rowCount:    number;
  fetchWindow: (offset: number, limit: number) => Promise<Record<string, unknown>[]>;
  columns:     ColumnInfo[];
  columnStats: Record<string, ColumnStats>;
  colWidths:   Record<string, number>;
  totalWidth:  number;
  onFirstData?: () => void;
}) {
  const [rows, setRows] = useState<Map<number, Record<string, unknown>>>(new Map());
  const firstDataFired = useRef(false);
  const fetchingRef = useRef<Set<string>>(new Set());

  const virtualizer = useVirtualizer({
    count:            rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize:     () => ROW_H,
    overscan:         40,
  });

  // Fetch visible rows — collect all distinct window starts for uncached rows
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    if (items.length === 0) return;
    const start = items[0].index;
    const end   = items[items.length - 1].index;

    // Collect all window starts that need fetching
    const windowStarts = new Set<number>();
    for (let i = start; i <= end; i++) {
      if (!rows.has(i)) {
        windowStarts.add(Math.floor(i / WINDOW_SIZE) * WINDOW_SIZE);
      }
    }

    for (const windowStart of windowStarts) {
      const key = `${windowStart}`;
      if (fetchingRef.current.has(key)) continue;
      fetchingRef.current.add(key);

      fetchWindow(windowStart, WINDOW_SIZE).then(fetched => {
        fetchingRef.current.delete(key);
        if (!firstDataFired.current && fetched.length > 0) {
          firstDataFired.current = true;
          onFirstData?.();
        }
        setRows(prev => {
          const next = new Map(prev);
          for (let i = 0; i < fetched.length; i++) {
            next.set(windowStart + i, fetched[i]);
          }
          return next;
        });
      }).catch((err) => {
        console.error('DuckDB Fetch Error:', err);
        fetchingRef.current.delete(key);
      });
    }
  // We intentionally only trigger on virtualizer scroll range changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length > 0 ? items[0].index : -1, items.length > 0 ? items[items.length - 1].index : -1, fetchWindow]);

  return (
    <>
      <div style={{ height: virtualizer.getTotalSize(), width: totalWidth }} />
      <div style={{ position: 'relative', width: totalWidth, marginTop: -virtualizer.getTotalSize() }}>
        {items.map(vRow => {
          const row = rows.get(vRow.index);

          return (
            <div key={vRow.key} className="flex"
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H,
                transform: `translateY(${vRow.start}px)`,
                background: vRow.index % 2 === 1 ? 'oklch(0.120 0.020 250 / 0.3)' : undefined,
              }}
            >
              {columns.map(c => {
                const w      = colWidths[c.name] ?? colWFromName(c.name, c.type);
                const isNum  = isNumericType(c.type);
                const stats  = isNum ? columnStats[c.name] : undefined;

                if (!row) {
                  // Skeleton placeholder for uncached rows — staggered by row+col
                  const pct = 55 + ((vRow.index * 17 + c.name.length * 11) % 40);
                  return (
                    <div key={c.name} style={{
                      width: w, minWidth: 50, flexShrink: 0,
                      padding: '0 6px',
                      borderBottom: '1px solid var(--color-line)',
                      lineHeight: `${ROW_H}px`,
                    }}>
                      <div className="skeleton rounded" style={{ height: 12, width: `${pct}%`, marginTop: 8 }} />
                    </div>
                  );
                }

                const raw    = row[c.name];
                const numVal = isNum ? (typeof raw === 'number' ? raw : NaN) : NaN;

                return (
                  <div key={c.name} style={{
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
                      : fmt(raw, c.type)
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

// ── ParquetPreview ─────────────────────────────────────────────────────────────

export default function ParquetPreview({ fileId }: {
  fileId: string;
}) {
  const {
    profileStatus, columns, totalRows, filteredCount,
    baseProfile, error,
    wasmReady, wasmStatus, wasmError,
    fetchWindow, applyFilters, isQuerying, cacheGen,
  } = useParquetPreview(fileId);

  // Demand-driven: fetch enrichable attributes from the server
  // Fires when columns are available — does NOT wait for WASM
  const { profile } = useDataProfile(
    columns.length > 0 ? fileId : null,
    ['columnStats', 'cardinality', 'charLengths'],
    baseProfile,
  );

  console.log('[PP:render]', {
    profileStatus,
    colCount: columns.length,
    wasmStatus,
    wasmReady,
    totalRows,
    hasStats: !!profile?.columnStats,
    hasCardinality: !!profile?.cardinality,
    statsKeys: profile?.columnStats ? Object.keys(profile.columnStats).length : 0,
  });

  // Derive stats and cardinality from server profile, handling null (negative cache)
  const columnStats: Record<string, ColumnStats> = useMemo(() => {
    const raw = profile?.columnStats;
    if (!raw) return {};
    const result: Record<string, ColumnStats> = {};
    for (const [name, s] of Object.entries(raw)) {
      result[name] = { min: s.min, max: s.max };
    }
    return result;
  }, [profile?.columnStats]);

  const columnCardinality: Record<string, ColumnCardinality> = useMemo(() => {
    const raw = profile?.cardinality;
    if (!raw) return {};
    const result: Record<string, ColumnCardinality> = {};
    for (const [name, c] of Object.entries(raw)) {
      result[name] = {
        distinct: c.distinct,
        values: (c.topValues ?? []).map(tv => tv.value),
      };
    }
    return result;
  }, [profile?.cardinality]);

  // ── Reprofile handler ──────────────────────────────────────────────────────
  const setFileProfile = useAppStore(s => s.setFileProfile);
  const [reprofiling, setReprofiling] = useState(false);
  const handleReprofile = useCallback(async () => {
    setReprofiling(true);
    try {
      const res = await apiFetch(`/api/files/${fileId}/reprofile`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.profile) {
        setFileProfile(fileId, {
          dataProfile: data.profile,
          parquetUrl: '',
          cachedAt: 0,
        });
        // Force page reload to pick up fresh profile
        window.location.reload();
      }
    } catch { /* non-fatal */ }
    finally { setReprofiling(false); }
  }, [fileId, setFileProfile]);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const headerRef   = useRef<HTMLDivElement>(null);
  const debRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizingRef = useRef<{ name: string; startX: number; startW: number } | null>(null);

  // ── State machine ────────────────────────────────────────────────────────
  // Single source of truth: pipelineIndex drives pipeline dots + table body.
  //   0 = Reading schema  → table body: empty void
  //   1 = Starting engine → table body: skeleton grid (columns known)
  //   2 = Opening dataset → table body: skeleton grid
  //   3 = Drawing rows    → table body: skeleton grid
  //   4 = Ready           → table body: real data
  const [hasData, setHasData] = useState(false);
  const [hasCurrentData, setHasCurrentData] = useState(false);
  const prevCacheGen = useRef(cacheGen);
  if (cacheGen !== prevCacheGen.current) {
    prevCacheGen.current = cacheGen;
    if (hasCurrentData) setHasCurrentData(false);
  }
  const handleFirstData = useCallback(() => {
    setHasData(true);
    setHasCurrentData(true);
  }, []);
  const stage = pipelineIndex(profileStatus, wasmStatus, isQuerying, hasData);

  // ── Synchronous initializers — Frame 1 ready, no useEffect ───────────────

  const charLengths = profile?.charLengths ?? null;

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const c of columns) init[c.name] = colWFromName(c.name, c.type, charLengths?.[c.name]?.max);
    return init;
  });

  const [rangeState, setRangeState] = useState<Record<string, [number, number]>>(() => {
    const init: Record<string, [number, number]> = {};
    for (const c of columns) {
      if (!isNumericType(c.type)) continue;
      const s = columnStats[c.name];
      if (s) init[c.name] = [s.min, s.max];
    }
    return init;
  });

  const triggerRef = useRef<() => void>(() => {});
  const [selected,           setSelected]           = useState<Record<string, Set<string>>>({});
  const [textFilters,        setTextFilters]        = useState<Record<string, string>>({});
  const [sort,               setSort]               = useState<SortSpec | null>(null);
  const [constrainedStats,   setConstrainedStats]   = useState<Record<string, ColumnStats>>({});
  const [pendingConstraints, setPendingConstraints] = useState(false);

  // ── Incremental updates — new columns or stats arriving after mount ────────

  useEffect(() => {
    if (columns.length === 0) return;
    setColWidths(prev => {
      let changed = false;
      const next = { ...prev };
      for (const c of columns) {
        const w = colWFromName(c.name, c.type, charLengths?.[c.name]?.max);
        if (!(c.name in next) || (charLengths?.[c.name] && next[c.name] !== w)) {
          next[c.name] = w;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [columns, charLengths]);

  useEffect(() => {
    const init: Record<string, [number, number]> = {};
    for (const c of columns) {
      if (!isNumericType(c.type)) continue;
      const s = columnStats[c.name];
      if (s && !rangeState[c.name]) init[c.name] = [s.min, s.max];
    }
    if (Object.keys(init).length > 0) setRangeState(prev => ({ ...init, ...prev }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnStats]);

  useEffect(() => () => { if (debRef.current) clearTimeout(debRef.current); }, []);

  // ── Build filter specs and apply ────────────────────────────────────────────

  const triggerFilters = useCallback(() => {
    if (!wasmReady) return; // accumulate in state; applied when WASM boots

    const filters: FilterSpec[] = [];

    // Range filters
    for (const [name, [lo, hi]] of Object.entries(rangeState)) {
      const stats = columnStats[name];
      if (!stats) continue;
      if (lo <= stats.min && hi >= stats.max) continue;
      filters.push({ column: name, op: { type: 'between', low: lo, high: hi } });
    }

    // Multi-select filters
    for (const [name, set] of Object.entries(selected)) {
      if (set.size === 0) continue;
      filters.push({ column: name, op: { type: 'in', values: [...set] } });
    }

    // Text filters
    for (const [name, text] of Object.entries(textFilters)) {
      if (!text.trim()) continue;
      filters.push({ column: name, op: { type: 'ilike', pattern: text.trim() } });
    }

    // Reset scroll to top — the filtered dataset starts at row 0
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    setPendingConstraints(true);
    applyFilters(filters, sort).then(result => {
      if (result.constrainedStats) setConstrainedStats(result.constrainedStats);
      else setConstrainedStats({});
      setPendingConstraints(false);
    }).catch((err) => {
      console.error('DuckDB Filter Error:', err);
      setPendingConstraints(false);
    });
  }, [wasmReady, rangeState, selected, textFilters, sort, columnStats, applyFilters]);

  // Keep ref synced so debounced callbacks always call the latest version
  triggerRef.current = triggerFilters;

  // Catch-up: apply accumulated filters when WASM becomes ready
  useEffect(() => {
    if (wasmReady) triggerFilters();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasmReady]);

  // ── Filter handlers ──────────────────────────────────────────────────────────

  const handleRangeChange = useCallback((name: string, lo: number, hi: number) => {
    setRangeState(prev => ({ ...prev, [name]: [lo, hi] }));
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => triggerRef.current(), 120);
  }, []);

  const handleTextChange = useCallback((name: string, value: string) => {
    setTextFilters(prev => ({ ...prev, [name]: value }));
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => triggerRef.current(), 300);
  }, []);

  const handleToggleSelect = useCallback((name: string, value: string) => {
    setSelected(prev => {
      const set = new Set(prev[name] ?? []);
      if (set.has(value)) set.delete(value); else set.add(value);
      if (set.size === 0) { const next = { ...prev }; delete next[name]; return next; }
      return { ...prev, [name]: set };
    });
    setTimeout(() => triggerRef.current(), 0);
  }, []);

  const handleClearSelect = useCallback((name: string) => {
    setSelected(prev => { const next = { ...prev }; delete next[name]; return next; });
    setTimeout(() => triggerRef.current(), 0);
  }, []);

  const handleClearAll = useCallback(() => {
    setRangeState({});
    setSelected({});
    setTextFilters({});
    // Need to re-init ranges from stats
    const init: Record<string, [number, number]> = {};
    for (const c of columns) {
      if (!isNumericType(c.type)) continue;
      const s = columnStats[c.name];
      if (s) init[c.name] = [s.min, s.max];
    }
    setRangeState(init);
    setConstrainedStats({});
    setPendingConstraints(false);
    // Clear filters on the hook
    applyFilters([], sort);
  }, [columns, columnStats, sort, applyFilters]);

  // ── Sort ────────────────────────────────────────────────────────────────────

  const handleSortClick = useCallback((name: string) => {
    setSort(prev => {
      const next = !prev || prev.column !== name
        ? { column: name, direction: 'asc' as const }
        : prev.direction === 'asc'
          ? { column: name, direction: 'desc' as const }
          : null;
      // Trigger filter re-apply with new sort
      setTimeout(() => triggerFilters(), 0);
      return next;
    });
  }, [triggerFilters]);

  // ── Column resize ──────────────────────────────────────────────────────────

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

  // ── Derived state ──────────────────────────────────────────────────────────

  // Filter out low-cardinality columns from the table (sidebar only)
  const tableColumns = useMemo(() => columns.filter(c => {
    const card = columnCardinality[c.name];
    return !card || card.distinct > 5;
  }), [columns, columnCardinality]);

  const totalWidth   = tableColumns.reduce((s, c) => s + (colWidths[c.name] ?? colWFromName(c.name, c.type)), 0);
  const hasAnyFilter = Object.entries(rangeState).some(([name, [lo, hi]]) => {
    const s = columnStats[name];
    return s && (lo > s.min || hi < s.max);
  }) || Object.keys(selected).some(k => selected[k].size > 0)
     || Object.values(textFilters).some(v => v.trim());
  const noResults  = hasAnyFilter && filteredCount === 0;

  // ── Loading / error states ─────────────────────────────────────────────────

  if (profileStatus === 'error' || wasmStatus === 'error') {
    const displayError = error || wasmError;
    return (
      <div className="flex items-center justify-center py-8">
        <Text variant="dim" style={{ color: 'var(--color-red)' }}>{displayError}</Text>
      </div>
    );
  }

  if (profileStatus === 'unavailable' || profileStatus === 'failed') return null;

  return (
    <>
    {/* Pipeline status — always visible, fixed height, outside the table */}
    <div style={{
      height: 32,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <PipelineStatus profileStatus={profileStatus} wasmStatus={wasmStatus} isQuerying={isQuerying} hasData={hasData} />
    </div>

    <div className="flex flex-col" style={{
      background: 'var(--color-void)', height: PANEL_H,
      opacity: stage >= 1 ? 1 : 0,
      transition: 'opacity var(--t-phi) var(--ease-phi)',
      backfaceVisibility: 'hidden',
    }}>

      {/* Pinned header row — sidebar header + table header share one flex row.
           align-items: stretch (default) forces identical cross-axis height.
           Rendered identically in loading and ready states — zero layout shift. */}
      <div className="flex shrink-0">

        {/* Sidebar header — fixed width, never scrolls, hidden on mobile */}
        <div className="hidden md:flex items-center justify-between shrink-0 border-r border-line"
          style={{
            width: SIDEBAR_W,
            padding: '3px 12px',
            background: 'var(--color-raised)',
            borderBottom: '2px solid var(--color-line)',
          }}>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold" style={{
              fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-2)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              Filters
            </span>
            {totalRows > 0 && (
              <span className="font-mono tabular-nums"
                style={{
                  fontSize: 'calc(var(--font-size-xs) - 1px)',
                  color: hasAnyFilter
                    ? (noResults ? 'oklch(0.650 0.180 30)' : 'var(--color-cyan)')
                    : 'var(--color-fg-3)',
                  opacity: pendingConstraints ? 0.5 : 1,
                  transition: 'color var(--t-fast), opacity var(--t-fast)',
                }}>
                {hasAnyFilter
                  ? `${filteredCount.toLocaleString()}/${totalRows.toLocaleString()}`
                  : totalRows.toLocaleString()
                }
              </span>
            )}
          </div>
          {/* Always rendered — visibility: hidden preserves spatial volume for zero CLS */}
          <button onClick={handleClearAll}
            className="cursor-pointer bg-transparent border-none transition-colors hover:text-fg"
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-fg-3)',
              visibility: hasAnyFilter ? 'visible' : 'hidden',
            }}>
            Clear all
          </button>
        </div>

        {/* Table header — gated on columns.length (data), not profileStatus (flag) */}
        <div ref={headerRef} className="flex-1 min-w-0 overflow-hidden font-mono"
          style={columns.length === 0
            ? { background: 'var(--color-raised)', borderBottom: '2px solid var(--color-line)' }
            : undefined}>
          {columns.length > 0 && (
            <div className="flex" style={{ width: totalWidth }}>
              {tableColumns.map(c => {
                const w       = colWidths[c.name] ?? colW(c.type);
                const sortDir = sort && sort.column === c.name ? sort.direction : null;
                return (
                  <div key={c.name}
                    className="text-left font-semibold text-fg-2 select-none relative group cursor-pointer"
                    style={{
                      width: w, minWidth: 50, flexShrink: 0, padding: '3px 6px',
                      background: 'var(--color-raised)',
                      borderBottom: `2px solid ${sortDir ? 'var(--color-cyan)' : 'var(--color-line)'}`,
                      whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)',
                    }}
                    onClick={() => handleSortClick(c.name)}
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate">{c.name}</span>
                      <SortChevron dir={sortDir} />
                    </div>
                    <span style={{ fontSize: 'calc(var(--font-size-xs) - 1px)', opacity: 0.35 }}>{c.type}</span>
                    <div
                      className="absolute top-0 right-0 bottom-0 opacity-0 group-hover:opacity-100"
                      style={{ width: 3, cursor: 'col-resize', background: 'var(--color-line)', transition: 'opacity var(--t-fast)' }}
                      onMouseDown={e => { e.stopPropagation(); handleResizeStart(c.name, e.clientX, w); }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-cyan)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-line)'; }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Body row */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar body — ALWAYS the same container div for layout stability.
             Content fades in when data arrives; no DOM structure change between states. */}
        <div className="hidden md:flex flex-col shrink-0 border-r border-line" style={{ width: SIDEBAR_W }}>
          {columns.length > 0 ? (
            <>
              <FilterSidebar
                columns={columns}
                columnStats={columnStats}
                columnCardinality={columnCardinality}
                rangeState={rangeState}
                selected={selected}
                textFilters={textFilters}
                onRangeChange={handleRangeChange}
                onToggleSelect={handleToggleSelect}
                onClearSelect={handleClearSelect}
                onTextChange={handleTextChange}
                hasAnyFilter={hasAnyFilter}
                constrainedStats={constrainedStats}
                noResults={noResults}
                pendingConstraints={pendingConstraints}
              />
              <button
                onClick={handleReprofile}
                disabled={reprofiling}
                className="cursor-pointer bg-transparent border-t border-line text-fg-3 hover:text-cyan transition-colors shrink-0"
                style={{ fontSize: 'var(--font-size-xs)', padding: '6px 12px', textAlign: 'left' }}
              >
                {reprofiling ? 'Profiling…' : 'Profile my data'}
              </button>
            </>
          ) : (
            /* Skeleton sidebar — matches ready layout structure for zero CLS */
            <div className="flex-1 overflow-hidden p-3 flex flex-col gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i}>
                  <div className="skeleton rounded" style={{ height: 10, width: `${50 + (i * 13) % 30}%`, marginBottom: 8 }} />
                  <div className="skeleton rounded" style={{ height: 22, width: '100%' }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Table body — ALWAYS the same scroll container. Loading states are overlays,
             not different DOM branches. Eliminates layout shift on state transitions. */}
        <div
          ref={scrollRef}
          className="flex-1 min-w-0 overflow-auto"
          style={{ position: 'relative' }}
          onScroll={() => {
            if (headerRef.current && scrollRef.current)
              headerRef.current.scrollLeft = scrollRef.current.scrollLeft;
          }}
        >
          {/* Skeleton grid — always mounted, opacity-driven.
               Hidden at stage 0 (no columns) and stage 4 (data painted). */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: 'var(--color-void)',
            opacity: (stage >= 1 && !hasCurrentData) ? 1 : 0,
            pointerEvents: (stage >= 1 && !hasCurrentData) ? 'auto' : 'none',
            transition: 'opacity var(--t-phi) var(--ease-phi)',
            backfaceVisibility: 'hidden',
          }}>
            <div className="flex flex-col">
              {Array.from({ length: Math.ceil(PANEL_H / ROW_H) }, (_, i) => (
                <div key={i} className="flex" style={{ height: ROW_H }}>
                  {tableColumns.map(c => (
                    <div key={c.name} style={{
                      width: colWidths[c.name] ?? colWFromName(c.name, c.type),
                      minWidth: 50, flexShrink: 0, padding: '0 6px',
                      borderBottom: '1px solid var(--color-line)',
                      lineHeight: `${ROW_H}px`,
                    }}>
                      <div className="skeleton rounded"
                        style={{ height: 12, width: `${55 + ((i * 17 + c.name.length * 11) % 40)}%`, marginTop: 8 }} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {wasmReady && filteredCount > 0 && (
            <VirtualRows
              key={cacheGen}
              scrollRef={scrollRef}
              rowCount={filteredCount}
              fetchWindow={fetchWindow}
              columns={tableColumns}
              columnStats={columnStats}
              colWidths={colWidths}
              totalWidth={totalWidth}
              onFirstData={handleFirstData}
            />
          )}

          {wasmReady && filteredCount === 0 && (
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
    </>
  );
}

/**
 * QueryWorkbench — server-side DuckDB over Parquet via POST /api/files/:id/query.
 *
 * UI: filter sidebar + virtualizer over streaming Arrow IPC.
 * Data layer: useFileQuery manages lifecycle, useFilterState manages constraints.
 */

import * as Popover from '@radix-ui/react-popover';
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CSSProperties, RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDataProfile } from '../hooks/useDataProfile';
import { useDerivedState } from '../hooks/useDerivedState';
import type {
  ColumnCardinality,
  ColumnInfo,
  ColumnStats,
  QueryPhase,
} from '../hooks/useFileQuery';
import { DROPDOWN_MAX, isNumericType, useFileQuery, WINDOW_SIZE } from '../hooks/useFileQuery';
import { useFilterState } from '../hooks/useFilterState';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../stores/useAppStore';
import type { StepperStep } from '../ui';
import { RiverGauge, Stepper, Text } from '../ui';
import RangeSlider from './RangeSlider';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROW_H = 28;
const PX_PER_CHAR = 7.5;
const CELL_PAD_X = 6; // padding: '_ 6px' on header/data cells
const CHEVRON_W = 8; // SortChevron svg width
const HEADER_GAP = 8; // gap-1 between ColName and chevron
const COL_CHROME = CELL_PAD_X * 2 + CHEVRON_W + HEADER_GAP;
const MIN_COL_W = 50;
const MAX_COL_W = 300;

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt(value: unknown, type: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (!type) return String(value);
  const base = type
    .replace(/\(.+\)/, '')
    .trim()
    .toUpperCase();
  if (base === 'FLOAT' || base === 'DOUBLE' || base === 'DECIMAL') {
    return (value as number).toFixed(2);
  }
  if (isNumericType(type)) {
    const n = value as number;
    const a = Math.abs(n);
    if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (a >= 10_000) return (n / 1_000).toFixed(1) + 'K';
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
  // Header wraps at `.` — width only needs to fit the longest segment.
  // Child segments get a `› ` prefix (2 chars).
  const segments = name.split('.');
  const headerChars = Math.max(...segments.map((s, i) => s.length + (i > 0 ? 2 : 0)));
  const dataChars = maxCharLen ?? headerChars;
  const chars = Math.max(headerChars, dataChars);
  const px = Math.round(chars * PX_PER_CHAR) + COL_CHROME;
  return Math.min(MAX_COL_W, Math.max(MIN_COL_W, px));
}

// ── SortChevron ───────────────────────────────────────────────────────────────

function SortChevron({ dir, index }: { dir: 'asc' | 'desc' | false | null; index?: number }) {
  const active = dir === 'asc' || dir === 'desc';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <svg
        width="8"
        height="5"
        viewBox="0 0 8 5"
        fill="currentColor"
        style={{
          transition: 'transform var(--t-fast) var(--ease-move)',
          transform: dir === 'desc' ? 'rotate(180deg)' : 'none',
          opacity: active ? 1 : 0.3,
          color: active ? 'var(--color-interactive)' : 'inherit',
        }}
      >
        <path d="M4 0L7.5 4.5H0.5L4 0Z" />
      </svg>
      {index !== undefined && index >= 0 && (
        <span style={{ fontSize: 9, color: 'var(--color-interactive)', fontWeight: 600 }}>
          {index + 1}
        </span>
      )}
    </span>
  );
}

// ── ColName — break at `.` (always newline), then at `_` (if needed) ─────────

function ColName({ name }: { name: string }) {
  const parts = name.split('.');
  if (parts.length === 1) return <span>{name}</span>;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
      <span style={{ color: 'var(--color-text-faint)' }}>{parts[0]}</span>
      {parts.slice(1).map((part, i) => (
        <span key={i}>
          <span style={{ color: 'var(--color-text-faint)' }}>› </span>
          {part}
        </span>
      ))}
    </span>
  );
}

// ── Convergence Array — 4 honest steps derived from real physics ───────────────

const CONVERGENCE_STEPS: StepperStep[] = [
  { key: 'connect', label: 'Connecting' },
  { key: 'scan', label: 'Scanning' },
  { key: 'query', label: 'Querying' },
  { key: 'ready', label: 'Ready' },
];

function deriveConvergenceStep(
  phase: QueryPhase,
  isQuerying: boolean,
  isFetchingRange: boolean,
  cacheGen: number,
): number {
  switch (phase) {
    case 'idle':
      return 0;
    case 'loading':
      return 1;
    case 'ready_background_work':
    case 'ready':
      if (isQuerying || isFetchingRange || cacheGen === 0) return 2;
      return 3;
    case 'unavailable':
    case 'failed':
    case 'error':
      return 0;
    default:
      return 0;
  }
}

// ── The View — where internal state meets the observer's eye ──────────────────

interface StructuralState {
  convergenceStep: number;
  convergenceSteps: StepperStep[];
  isReady: boolean;
  isTerminal: boolean;
  flowState: 'normal' | 'pending' | 'stalled';
  flowLabel: string | undefined;
  isPending: boolean;
  showSkeleton: boolean;
}

interface DataState {
  hasFilter: boolean;
  noResults: boolean;
}

function deriveStructuralState(
  lifecycle: {
    phase: QueryPhase;
    error: string | null;
    queryError: Error | string | null;
    isQuerying: boolean;
  },
  isFetchingRange: boolean,
  cacheGen: number,
): StructuralState {
  const { phase, error, queryError, isQuerying } = lifecycle;

  const convergenceStep = deriveConvergenceStep(phase, isQuerying, isFetchingRange, cacheGen);

  const isTerminal = phase === 'error' || phase === 'failed' || phase === 'unavailable';
  const isReady = phase === 'ready' || phase === 'ready_background_work';

  const displayError = isTerminal ? error : undefined;
  const convergenceSteps: StepperStep[] = displayError
    ? CONVERGENCE_STEPS.map((s, i) => (i === convergenceStep ? { ...s, error: displayError } : s))
    : [...CONVERGENCE_STEPS];

  const flowState: StructuralState['flowState'] = queryError
    ? 'stalled'
    : isQuerying
      ? 'pending'
      : 'normal';
  const flowLabel = queryError ? 'query failed' : undefined;

  const isPending = isQuerying || isFetchingRange;
  const showSkeleton = convergenceStep < 2 || (convergenceStep === 2 && cacheGen === 0);

  return { convergenceStep, convergenceSteps, isReady, isTerminal, flowState, flowLabel, isPending, showSkeleton };
}

function deriveDataState(filterCount: number, count: number): DataState {
  const hasFilter = filterCount > 0;
  const noResults = hasFilter && count === 0;
  return { hasFilter, noResults };
}


// ── MultiSelect ───────────────────────────────────────────────────────────────

function MultiSelect({
  values,
  selected,
  onToggle,
  onClear,
}: {
  values: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = selected.size;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="w-full flex items-center justify-between gap-1.5 rounded-sm border border-border px-2 py-1 cursor-pointer bg-transparent transition-colors"
          style={{ fontSize: 'var(--font-size-xs)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--color-surface)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <span
            className="truncate"
            style={{ color: count > 0 ? 'var(--color-text)' : 'var(--color-text-faint)' }}
          >
            {count > 0 ? `${count} of ${values.length}` : 'All'}
          </span>
          {count > 0 ? (
            <span
              className="shrink-0 rounded px-1 font-mono font-bold tabular-nums"
              style={{
                fontSize: 'var(--font-size-xs)',
                background: 'var(--color-interactive)',
                color: 'var(--color-surface-sunken)',
              }}
            >
              {count}
            </span>
          ) : (
            <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0 opacity-40">
              <path
                d="M2 3l2 2 2-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className="border border-border shadow-lg rounded-md z-popover animate-fade-in"
          style={{
            minWidth: 'var(--radix-popover-trigger-width)',
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--color-surface-sunken)',
          }}
        >
          {count > 0 && (
            <button
              className="block w-full text-left px-2 py-1.5 font-mono cursor-pointer bg-transparent border-none"
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-faint)',
                borderBottom: '1px solid var(--color-border)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-surface)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Clear selection
            </button>
          )}
          {values.map((v) => (
            <label
              key={v}
              className="flex items-center gap-2 px-2 py-1 cursor-pointer"
              style={{ fontSize: 'var(--font-size-xs)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-surface)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(v)}
                onChange={() => onToggle(v)}
                style={{ accentColor: 'var(--color-interactive)', flexShrink: 0 }}
              />
              <span
                className="font-mono truncate"
                style={{
                  color: selected.has(v) ? 'var(--color-interactive)' : 'var(--color-text)',
                  fontWeight: selected.has(v) ? 600 : 400,
                }}
              >
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

function InlineSelect({
  values,
  selected,
  onToggle,
}: {
  values: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => {
        const on = selected.has(v);
        return (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className={`sigil sigil-sm ${on ? 'active' : ''}`}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

// ── Column Partitioning — Constants vs Variables ─────────────────────────────

function partitionColumns(
  columns: ColumnInfo[],
  columnStats: Record<string, ColumnStats>,
  columnCardinality: Record<string, ColumnCardinality>,
): {
  constants: { col: ColumnInfo; value: string }[];
  variables: ColumnInfo[];
  tableEligible: ColumnInfo[];
} {
  const constants: { col: ColumnInfo; value: string }[] = [];
  const variables: ColumnInfo[] = [];
  const tableEligible: ColumnInfo[] = [];

  for (const c of columns) {
    const isNum = isNumericType(c.type);
    // Partition using GLOBAL stats only — never constrainedStats.
    // A column that becomes single-valued under a filter must keep its slider
    // so the user can adjust or remove the filter.
    const stats = columnStats[c.name];
    const card = columnCardinality[c.name];

    if (isNum && stats && stats.min === stats.max) {
      const v = Number.isInteger(stats.min) ? stats.min.toLocaleString() : stats.min.toFixed(2);
      constants.push({ col: c, value: v });
    } else if (card && card.distinct === 1 && card.values.length === 1) {
      constants.push({ col: c, value: card.values[0] });
    } else {
      variables.push(c);
      tableEligible.push(c);
    }
  }
  return { constants, variables, tableEligible };
}

// ── ControlCenter (was FilterSidebar) ─────────────────────────────────────────

const RangeSliderCard = memo(function RangeSliderCard({
  column,
  stats,
  constrainedStats,
  rangeState,
  hasAnyFilter,
  isPending,
  staticHistogram,
  dynamicHistogram,
  onDrag,
  onCommit,
  onSortByCorrelation,
  visible,
  onToggleVisible,
}: {
  column: ColumnInfo;
  stats: ColumnStats | undefined;
  constrainedStats: ColumnStats | undefined;
  rangeState: [number, number] | undefined;
  hasAnyFilter: boolean;
  isPending: boolean;
  staticHistogram: number[] | undefined;
  dynamicHistogram: number[] | undefined;
  onDrag: (name: string, lo: number, hi: number) => void;
  onCommit: (name: string, lo: number, hi: number) => void;
  onSortByCorrelation?: () => void;
  visible: boolean;
  onToggleVisible: (name: string) => void;
}) {
  const active = !!(
    rangeState &&
    stats &&
    (rangeState[0] > stats.min || rangeState[1] < stats.max)
  );

  return (
    <div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible(column.name);
          }}
          className="font-semibold cursor-pointer select-none"
          title={visible ? 'Hide in table' : 'Show in table'}
          style={{
            fontSize: 'var(--font-size-xs)',
            color: active
              ? 'var(--color-interactive)'
              : visible
                ? 'var(--color-text-muted)'
                : 'var(--color-text-faint)',
            borderBottom: visible
              ? '1px solid var(--color-interactive)'
              : '1px dashed var(--color-text-faint)',
            opacity: visible ? 1 : 0.5,
            transition: 'color var(--t-fast), opacity var(--t-fast), border-color var(--t-fast)',
          }}
        >
          {column.name}
        </span>
        <span
          className="font-mono shrink-0 ml-auto"
          style={{ fontSize: 'calc(var(--font-size-xs) - 1px)', opacity: 0.25 }}
        >
          {column.type}
        </span>
      </div>

      {!stats ? (
        <div style={{ height: 20, position: 'relative' }}>
          <div
            className="skeleton rounded-full"
            style={{
              height: 2,
              width: '100%',
              position: 'absolute',
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          />
        </div>
      ) : stats.min === stats.max ? (
        <span
          className="font-mono"
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-faint)',
            fontStyle: 'italic',
          }}
        >
          {Number.isInteger(stats.min) ? stats.min.toLocaleString() : stats.min.toFixed(2)}{' '}
          (constant)
        </span>
      ) : (
        <RangeSlider
          name={column.name}
          min={stats.min}
          max={stats.max}
          low={rangeState?.[0] ?? stats.min}
          high={rangeState?.[1] ?? stats.max}
          constrainedMin={hasAnyFilter ? constrainedStats?.min : undefined}
          constrainedMax={hasAnyFilter ? constrainedStats?.max : undefined}
          pending={isPending}
          hasAnyFilter={hasAnyFilter}
          onDrag={onDrag}
          onCommit={onCommit}
          staticHistogram={staticHistogram}
          dynamicHistogram={hasAnyFilter ? dynamicHistogram : undefined}
          onSortByCorrelation={onSortByCorrelation}
        />
      )}
    </div>
  );
});

const ControlCenter = memo(function ControlCenter({
  columns,
  columnStats,
  columnCardinality,
  rangeState,
  selected,
  textFilters,
  onRangeDrag,
  onRangeCommit,
  onToggleSelect,
  onClearSelect,
  onTextChange,
  hasAnyFilter,
  constrainedStats,
  noResults,
  isPending,
  staticHistograms,
  constrainedHistograms,
  visibleColumns,
  onToggleVisible,
  profileCorrelations,
}: {
  columns: ColumnInfo[];
  columnStats: Record<string, ColumnStats>;
  columnCardinality: Record<string, ColumnCardinality>;
  rangeState: Record<string, [number, number]>;
  selected: Record<string, Set<string>>;
  textFilters: Record<string, string>;
  onRangeDrag: (name: string, lo: number, hi: number) => void;
  onRangeCommit: (name: string, lo: number, hi: number) => void;
  onToggleSelect: (name: string, v: string) => void;
  onClearSelect: (name: string) => void;
  onTextChange: (name: string, v: string) => void;
  hasAnyFilter: boolean;
  constrainedStats: Record<string, ColumnStats>;
  noResults: boolean;
  isPending: boolean;
  staticHistograms: Record<string, number[]>;
  constrainedHistograms: Record<string, number[]>;
  visibleColumns: Set<string>;
  onToggleVisible: (name: string) => void;
  profileCorrelations: Record<string, number> | null;
}) {
  // ── Sort by correlation — right-click a slider → reorder by |r| ───────
  const [corrSortCol, setCorrSortCol] = useState<string | null>(null);

  // Partition into low-cardinality chips, numerics, and text columns
  const lowCard: { col: ColumnInfo; card: ColumnCardinality; sel: Set<string> }[] = [];
  const numerics: ColumnInfo[] = [];
  const texts: ColumnInfo[] = [];

  for (const c of columns) {
    const isNum = isNumericType(c.type);
    const card = columnCardinality[c.name];
    const hasCard = card && card.distinct >= 1 && card.distinct <= DROPDOWN_MAX;
    if (!isNum && hasCard && card.values.length > 1 && card.values.length <= 6) {
      lowCard.push({ col: c, card, sel: selected[c.name] ?? new Set<string>() });
    } else if (isNum) {
      numerics.push(c);
    } else {
      texts.push(c);
    }
  }

  // Sort numerics by correlation to a selected column, or keep original order
  const sortedNumerics = useMemo(() => {
    if (!corrSortCol || !profileCorrelations) return numerics;
    const getCorr = (name: string): number => {
      if (name === corrSortCol) return Infinity; // pinned column goes first
      const key1 = `${corrSortCol}:${name}`;
      const key2 = `${name}:${corrSortCol}`;
      return Math.abs(profileCorrelations[key1] ?? profileCorrelations[key2] ?? 0);
    };
    return [...numerics].sort((a, b) => getCorr(b.name) - getCorr(a.name));
  }, [numerics, corrSortCol, profileCorrelations]);

  const renderTextCard = (c: ColumnInfo) => {
    const card = columnCardinality[c.name];
    const sel = selected[c.name] ?? new Set<string>();
    const hasCard = card && card.distinct >= 1 && card.distinct <= DROPDOWN_MAX;
    const active = hasCard ? sel.size > 0 : !!textFilters[c.name]?.trim();

    return (
      <div key={c.name}>
        <div className="flex items-baseline gap-1.5 mb-1">
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisible(c.name);
            }}
            className="font-semibold cursor-pointer select-none"
            title={visibleColumns.has(c.name) ? 'Hide in table' : 'Show in table'}
            style={{
              fontSize: 'var(--font-size-xs)',
              color: active
                ? 'var(--color-interactive)'
                : visibleColumns.has(c.name)
                  ? 'var(--color-text-muted)'
                  : 'var(--color-text-faint)',
              borderBottom: visibleColumns.has(c.name)
                ? '1px solid var(--color-interactive)'
                : '1px dashed var(--color-text-faint)',
              opacity: visibleColumns.has(c.name) ? 1 : 0.5,
              transition: 'color var(--t-fast), opacity var(--t-fast), border-color var(--t-fast)',
            }}
          >
            {c.name}
          </span>
          <span
            className="font-mono shrink-0 ml-auto"
            style={{ fontSize: 'calc(var(--font-size-xs) - 1px)', opacity: 0.25 }}
          >
            {c.type}
          </span>
        </div>

        {hasCard ? (
          card.values.length === 1 ? (
            <span
              className="font-mono"
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-faint)',
                fontStyle: 'italic',
              }}
            >
              {card.values[0]} (constant)
            </span>
          ) : card.values.length <= 6 ? (
            <InlineSelect
              values={card.values}
              selected={sel}
              onToggle={(v) => onToggleSelect(c.name, v)}
            />
          ) : (
            <MultiSelect
              values={card.values}
              selected={sel}
              onToggle={(v) => onToggleSelect(c.name, v)}
              onClear={() => onClearSelect(c.name)}
            />
          )
        ) : (
          <input
            className="w-full bg-transparent border border-border rounded-sm text-text-muted font-mono placeholder:text-text-faint focus:outline-none"
            style={{
              fontSize: 'var(--font-size-xs)',
              padding: '3px 6px',
              borderColor: textFilters[c.name]?.trim() ? 'var(--color-interactive)' : undefined,
              transition: 'border-color var(--t-fast)',
            }}
            placeholder="Search…"
            value={textFilters[c.name] ?? ''}
            onChange={(e) => onTextChange(c.name, e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    );
  };

  return (
    <div style={{ opacity: noResults ? 0.35 : 1, transition: 'opacity var(--t-fast)' }}>
      {/* Low-cardinality chip groups — togglable filters at the top */}
      {lowCard.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 px-4 pt-4 pb-2">
          {lowCard.map(({ col, card, sel }) => (
            <div key={col.name} className="flex items-center gap-1.5">
              <span
                className="font-semibold shrink-0"
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: sel.size > 0 ? 'var(--color-interactive)' : 'var(--color-text-faint)',
                }}
              >
                {col.name}
              </span>
              {card.values.map((v) => {
                const on = sel.has(v);
                return (
                  <button
                    key={v}
                    onClick={() => onToggleSelect(col.name, v)}
                    className={`sigil sigil-sm ${on ? 'active' : ''}`}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Two-column layout: numerics left, text right */}
      <div
        className="grid gap-4 p-4"
        style={{ gridTemplateColumns: numerics.length > 0 && texts.length > 0 ? '1fr 1fr' : '1fr' }}
      >
        {sortedNumerics.length > 0 && (
          <div
            className="grid gap-4 content-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {corrSortCol && (
              <button
                className="text-xs font-mono cursor-pointer bg-transparent border-none"
                style={{ color: 'var(--color-text-faint)', justifySelf: 'start', padding: '0 0 4px' }}
                onClick={() => setCorrSortCol(null)}
              >
                ✕ Clear correlation sort
              </button>
            )}
            {sortedNumerics.map((c) => (
              <RangeSliderCard
                key={c.name}
                column={c}
                stats={columnStats[c.name]}
                constrainedStats={constrainedStats[c.name]}
                rangeState={rangeState[c.name]}
                hasAnyFilter={hasAnyFilter}
                isPending={isPending}
                staticHistogram={staticHistograms[c.name]}
                dynamicHistogram={constrainedHistograms[c.name]}
                onDrag={onRangeDrag}
                onCommit={onRangeCommit}
                onSortByCorrelation={profileCorrelations ? () => setCorrSortCol(c.name) : undefined}
                visible={visibleColumns.has(c.name)}
                onToggleVisible={onToggleVisible}
              />
            ))}
          </div>
        )}
        {texts.length > 0 && (
          <div
            className="grid gap-4 content-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {texts.map(renderTextCard)}
          </div>
        )}
      </div>
    </div>
  );
});

// ── VirtualRows ───────────────────────────────────────────────────────────────

const VirtualRows = memo(function VirtualRows({
  scrollRef,
  rowCount,
  fetchRange,
  getCell,
  hasRow,
  columns,
  columnStats,
  colWidths,
  totalWidth,
  pulseStatus,
  cacheGen: _cacheGen,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  rowCount: number;
  fetchRange: (offset: number, limit: number, signal?: AbortSignal) => Promise<void>;
  getCell: (globalIndex: number, colName: string) => unknown;
  hasRow: (globalIndex: number) => boolean;
  columns: ColumnInfo[];
  columnStats: Record<string, ColumnStats>;
  colWidths: Record<string, number>;
  totalWidth: number;
  pulseStatus: QueryPhase;
  cacheGen: number; // prop change triggers re-render when Arrow data arrives
}) {
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 20,
    initialRect: { width: 0, height: 800 },
  });

  // Debounced fetch — waits 150ms after scroll stops before hitting the server.
  // Cancels in-flight requests when the viewport moves again.
  // Eviction handled by the hook's fetchRange (caps at MAX_CACHED_TABLES).
  const items = virtualizer.getVirtualItems();
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const start = items.length > 0 ? items[0].index : -1;
  const end = items.length > 0 ? items[items.length - 1].index : -1;

  useEffect(() => {
    if (start < 0) return;
    if (pulseStatus !== 'ready' && pulseStatus !== 'ready_background_work') return;

    // Collect window starts that need fetching
    const windowStarts: number[] = [];
    const seen = new Set<number>();
    for (let i = start; i <= end; i++) {
      if (!hasRow(i)) {
        const ws = Math.floor(i / WINDOW_SIZE) * WINDOW_SIZE;
        if (!seen.has(ws)) {
          seen.add(ws);
          windowStarts.push(ws);
        }
      }
    }

    if (windowStarts.length === 0) return;

    clearTimeout(timerRef.current);
    abortRef.current?.abort();

    timerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      Promise.all(
        windowStarts.map((ws) => fetchRange(ws, WINDOW_SIZE, controller.signal).catch(() => {})),
      );
      // No local state update — fetchRange stores the Arrow table in the
      // hook's cache and bumps cacheGen, which propagates as a prop change.
    }, 150);

    return () => {
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [start, end, fetchRange, hasRow, pulseStatus, _cacheGen]);

  return (
    <>
      <div style={{ height: virtualizer.getTotalSize(), minWidth: '100%', width: totalWidth }} />
      <div
        style={{
          position: 'relative',
          minWidth: '100%',
          width: totalWidth,
          marginTop: -virtualizer.getTotalSize(),
        }}
      >
        {items.map((vRow) => {
          const rowLoaded = hasRow(vRow.index);

          return (
            <div
              key={vRow.key}
              className="flex"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_H,
                transform: `translateY(${Math.round(vRow.start)}px)`,
              }}
            >
              {columns.map((c) => {
                const w = colWidths[c.name] ?? colWFromName(c.name, c.type);
                const isNum = isNumericType(c.type);
                const stats = isNum ? columnStats[c.name] : undefined;

                if (!rowLoaded) {
                  const pct = 55 + ((vRow.index * 17 + c.name.length * 11) % 40);
                  return (
                    <div
                      key={c.name}
                      style={{
                        width: w,
                        minWidth: 50,
                        flexShrink: 0,
                        padding: '0 6px',
                        borderBottom: '1px solid var(--color-border)',
                        lineHeight: `${ROW_H}px`,
                      }}
                    >
                      <div
                        className="skeleton rounded"
                        style={{
                          height: 12,
                          width: `${pct}%`,
                          marginTop: 8,
                          ...(isNum ? { marginLeft: 'auto' } : {}),
                        }}
                      />
                    </div>
                  );
                }

                // Direct Arrow vector access — no materialized Record
                const raw = getCell(vRow.index, c.name);
                const numVal = isNum ? (typeof raw === 'number' ? raw : NaN) : NaN;

                return (
                  <div
                    key={c.name}
                    style={{
                      width: w,
                      minWidth: 50,
                      flexShrink: 0,
                      padding: '0 6px',
                      borderBottom: '1px solid var(--color-border)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: isNum ? 'right' : 'left',
                      fontVariantNumeric: isNum ? 'tabular-nums' : undefined,
                      lineHeight: `${ROW_H}px`,
                      fontSize: 'var(--font-size-xs)',
                      fontFamily: 'var(--font-mono)',
                      ...(stats && !isNaN(numVal) ? heatStyle(numVal, stats.min, stats.max) : {}),
                    }}
                  >
                    {raw === null || raw === undefined ? (
                      <span style={{ color: 'var(--color-text-faint)', fontStyle: 'italic' }}>—</span>
                    ) : (
                      fmt(raw, c.type)
                    )}
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

// ── QueryWorkbench ────────────────────────────────────────────────────────────

export default function QueryWorkbench({
  fileId,
  filename,
  onProgress,
}: {
  fileId: string;
  filename?: string;
  onProgress?: (config: { steps: StepperStep[]; active: number } | null) => void;
}) {
  // ── Profile enrichment — early access for filter state ──
  const cachedProfile = useAppStore((s) => s.fileProfiles[fileId]?.dataProfile ?? null);

  const { profile } = useDataProfile(
    cachedProfile?.schema?.length ? fileId : null,
    ['columnStats', 'cardinality', 'charLengths', 'initialRows', 'histograms', 'correlations'],
    cachedProfile,
  );

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
        values: (c.topValues ?? []).map((tv) => tv.value),
      };
    }
    return result;
  }, [profile?.cardinality]);

  const staticHistograms: Record<string, number[]> = useMemo(() => {
    const h = profile?.histograms;
    return h ?? {};
  }, [profile?.histograms]);

  // ── Filter state ──
  const filters = useFilterState(columnStats);

  // ── Drawer state (declared early — useFileQuery gates preflight on it) ──
  const [drawerState, setDrawerState] = useState<'closed' | 'opening' | 'open'>('closed');

  // ── Query engine — reacts to filter intent automatically ──
  const { lifecycle, snapshot, settledSnapshot, store } = useFileQuery(fileId, filters.specs, filters.sortSpecs, drawerState !== 'closed');
  const {
    columns,
    baseProfile,
    getCell,
    hasRow,
    fetchRange,
    clearCache,
    isFetchingRange,
    cacheGen,
  } = store;

  // ── View derivation — split into structural (phase/skeleton) and data (count/filters) ──
  const structural = useMemo(
    () => deriveStructuralState(lifecycle, isFetchingRange, cacheGen),
    [lifecycle.phase, lifecycle.error, lifecycle.queryError, lifecycle.isQuerying, isFetchingRange, cacheGen],
  );

  const dataState = useMemo(
    () => deriveDataState(filters.specs.length, snapshot.count),
    [filters.specs.length, snapshot.count],
  );

  // ── Export handler — filtered TSV download ──────────────────────────────────
  const handleExport = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/files/${fileId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: filters.specs, sort: filters.sortSpecs }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="(.+?)"/);
      const name = match?.[1] ?? 'export.tsv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* non-fatal — toast could go here later */
    }
  }, [fileId, filters.specs, filters.sortSpecs]);

  // ── Reprofile handler ──────────────────────────────────────────────────────
  const setFileProfile = useAppStore((s) => s.setFileProfile);
  const [_reprofiling, setReprofiling] = useState(false);
  const _handleReprofile = useCallback(async () => {
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
    } catch {
      /* non-fatal */
    } finally {
      setReprofiling(false);
    }
  }, [fileId, setFileProfile]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<{ name: string; startX: number; startW: number } | null>(null);
  const resizeRafId = useRef<number | null>(null);

  // ── Broadcast pulse state to parent via onProgress ─────────────────────────
  useEffect(() => {
    if (lifecycle.phase === 'unavailable' || lifecycle.phase === 'failed') {
      onProgress?.(null);
      return;
    }
    onProgress?.({ steps: structural.convergenceSteps, active: structural.convergenceStep });
  }, [structural.convergenceStep, structural.isTerminal, structural.convergenceSteps]);

  // Cleanup: clear stepper when unmounting
  useEffect(() => {
    return () => onProgress?.(null);
  }, [onProgress]);

  // ── Synchronous initializers — Frame 1 ready, no useEffect ───────────────

  const charLengths = profile?.charLengths ?? null;

  // Column widths: base defaults from column metadata, user resize overrides on top.
  const [colWidths, setColWidthOverrides] = useDerivedState(
    (overrides: Record<string, number>) => {
      const result: Record<string, number> = {};
      for (const c of columns) {
        result[c.name] =
          overrides[c.name] ?? colWFromName(c.name, c.type, charLengths?.[c.name]?.max);
      }
      return result;
    },
    [columns, charLengths],
    {} as Record<string, number>,
  );

  // Range display state: drag visuals take priority over committed ledger.
  // The Basin only sees rangeOverrides. The UI sees dragVisuals first.
  const rangeState: Record<string, [number, number]> = useMemo(() => {
    const result: Record<string, [number, number]> = {};
    for (const c of columns) {
      if (!isNumericType(c.type)) continue;
      const s = columnStats[c.name];
      if (s)
        result[c.name] = filters.dragVisuals[c.name] ??
          filters.rangeOverrides[c.name] ?? [s.min, s.max];
    }
    return result;
  }, [columns, columnStats, filters.dragVisuals, filters.rangeOverrides]);

  // ── Column visibility state ─────────────────────────────────────────────────

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    () => new Set(columns.map((c) => c.name)),
  );

  // Seed visibleColumns when columns first arrive
  const seededRef = useRef(false);
  if (columns.length > 0 && !seededRef.current && visibleColumns.size === 0) {
    seededRef.current = true;
    setVisibleColumns(new Set(columns.map((c) => c.name)));
  }

  // activeColumns is defined after partitionColumns — see Derived state section.

  const handleToggleVisible = useCallback((name: string) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // ── TanStack Table (header sort state only) ────────────────────────────────

  const columnDefs: ColumnDef<unknown>[] = useMemo(
    () =>
      columns.map((c) => ({
        id: c.name,
        accessorKey: c.name,
        meta: { type: c.type },
      })),
    [columns],
  );

  const table = useReactTable({
    data: [],
    columns: columnDefs,
    state: { sorting: filters.sorting },
    onSortingChange: filters.setSorting,
    manualSorting: true,
    enableMultiSort: true,
    getCoreRowModel: getCoreRowModel(),
  });

  // ── Scroll reset — when the riverbed changes shape, start from the top ──
  const filterKey = JSON.stringify(filters.specs);
  const prevFilterKeyRef = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKeyRef.current !== filterKey) {
      prevFilterKeyRef.current = filterKey;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [filterKey]);

  // ── Column resize ──────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((name: string, startX: number, startW: number) => {
    resizingRef.current = { name, startX, startW };
    const onMove = (e: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      r.startW = Math.max(50, r.startW + e.clientX - r.startX);
      r.startX = e.clientX;
      if (resizeRafId.current == null) {
        resizeRafId.current = requestAnimationFrame(() => {
          resizeRafId.current = null;
          const cur = resizingRef.current;
          if (cur) setColWidthOverrides((prev) => ({ ...prev, [cur.name]: cur.startW }));
        });
      }
    };
    const onUp = () => {
      if (resizeRafId.current != null) {
        cancelAnimationFrame(resizeRafId.current);
        resizeRafId.current = null;
        // Flush final width
        const cur = resizingRef.current;
        if (cur) setColWidthOverrides((prev) => ({ ...prev, [cur.name]: cur.startW }));
      }
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

  // Partition columns into constants (single-value), variables (filterable), and tableEligible.
  // Low-cardinality categoricals (≤5 distinct) appear in the ControlCenter as chips
  // but never in the table — only tableEligible columns populate the data drawer.
  const { constants, variables, tableEligible } = useMemo(
    () => partitionColumns(columns, columnStats, columnCardinality),
    [columns, columnStats, columnCardinality],
  );

  // activeColumns: table-eligible columns that are toggled visible.
  // Constants live in the Metadata Crown badges. Low-cardinality categoricals
  // live in the ControlCenter as InlineSelect chips. Neither appears in the table.
  const activeColumns = useMemo(
    () => tableEligible.filter((c) => visibleColumns.has(c.name)),
    [tableEligible, visibleColumns],
  );

  const activeTotalWidth = activeColumns.reduce(
    (s, c) => s + (colWidths[c.name] ?? colWFromName(c.name, c.type, charLengths?.[c.name]?.max)),
    0,
  );

  // Frozen snapshot for the skeleton grid — captured once when columns arrive, never changes.
  const skelRef = useRef<{ cols: ColumnInfo[]; widths: Record<string, number> } | null>(null);
  if (activeColumns.length > 0 && !skelRef.current) {
    skelRef.current = {
      cols: activeColumns,
      widths: Object.fromEntries(
        activeColumns.map((c) => [c.name, colWidths[c.name] ?? colWFromName(c.name, c.type)]),
      ),
    };
  }

  // Memoized skeleton JSX
  const skelData = skelRef.current;
  const SKEL_ROWS = 15;
  const skeletonGrid = useMemo(() => {
    if (!skelData) return null;
    const skelTotalWidth = skelData.cols.reduce(
      (s, c) => s + (skelData.widths[c.name] ?? colWFromName(c.name, c.type)),
      0,
    );
    return (
      <div className="flex flex-col" style={{ width: skelTotalWidth }}>
        {Array.from({ length: SKEL_ROWS }, (_, i) => (
          <div key={i} className="flex" style={{ height: ROW_H }}>
            {skelData.cols.map((c) => {
              const isNum = isNumericType(c.type);
              return (
                <div
                  key={c.name}
                  style={{
                    width: skelData.widths[c.name] ?? colWFromName(c.name, c.type),
                    minWidth: 50,
                    flexShrink: 0,
                    padding: '0 6px',
                    borderBottom: '1px solid var(--color-border)',
                    lineHeight: `${ROW_H}px`,
                  }}
                >
                  <div
                    className="skeleton rounded"
                    style={{
                      height: 12,
                      width: `${55 + ((i * 17 + c.name.length * 11) % 40)}%`,
                      marginTop: 8,
                      ...(isNum ? { marginLeft: 'auto' } : {}),
                    }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }, [skelData]);

  // Memoize the entire skeleton overlay
  const skeletonOverlay = useMemo(
    () => (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          background: 'var(--color-surface-sunken)',
          opacity: structural.showSkeleton ? 1 : 0,
          pointerEvents: structural.showSkeleton ? 'auto' : 'none',
        }}
      >
        {structural.showSkeleton && skeletonGrid}
      </div>
    ),
    [structural.showSkeleton, skeletonGrid],
  );

  // ── Extension pop-out ────────────────────────────────────────────────────
  const [showExt, setShowExt] = useState(true);
  const extensionRef = useCallback((n: HTMLDivElement | null) => {
    if (n) new ResizeObserver(() => setShowExt(n.scrollWidth <= n.clientWidth)).observe(n);
  }, []);
  const dotIdx = filename?.lastIndexOf('.') ?? -1;
  const stem = dotIdx > 0 ? filename!.slice(0, dotIdx) : (filename ?? '');
  const ext = dotIdx > 0 ? `.${filename!.slice(dotIdx + 1)}` : '';

  // ── Loading / error states ─────────────────────────────────────────────────

  if (structural.isTerminal) return null;

  return (
    <div
      className="flex flex-col flex-1"
      style={{
        background: 'var(--color-surface-sunken)',
        minHeight: 600,
      }}
    >
      {/* ── Glass Canopy ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 shrink-0 glass-canopy mx-3 mt-3 px-4 pt-3 pb-6 flex flex-col gap-1">
        <div className="grid grid-cols-3 items-center">
          {/* Pillar 1: Filename */}
          <div className="min-w-0 relative">
            {filename && (
              <>
                {/* Measurement ghost — always renders both, drives showExt */}
                <div
                  ref={extensionRef}
                  className="invisible absolute inset-x-0 flex items-baseline gap-1 overflow-hidden whitespace-nowrap"
                  aria-hidden="true"
                >
                  <span className="text-lg font-bold tracking-tight">{stem}</span>
                  <span className="text-lg font-normal shrink-0">{ext}</span>
                </div>
                {/* Visible */}
                <div className="flex items-baseline gap-1 min-w-0">
                  <span className="text-lg font-bold tracking-tight text-text truncate" title={filename}>{stem}</span>
                  <span className={`text-lg font-normal text-interactive/70 overflow-hidden transition-[opacity,max-width] duration-300 ease-[cubic-bezier(0.382,0,0.618,1)] ${showExt ? 'opacity-100 max-w-40' : 'opacity-0 max-w-0'}`}>{ext}</span>
                </div>
              </>
            )}
          </div>

          {/* Pillar 2: Stepper + Status */}
          <div className="flex flex-col items-center">
            <Stepper steps={structural.convergenceSteps} active={structural.convergenceStep} />
          </div>

          {/* Pillar 3: Command Cluster */}
          <div className="flex justify-end items-center gap-2">
            <button
              type="button"
              onClick={filters.resetFilters}
              className={`ghost flex items-center gap-1 px-2 py-0.5 rounded font-mono uppercase tracking-widest cursor-pointer bg-transparent border-none text-interactive/70 hover:text-interactive hover:bg-interactive/10 active:scale-95 text-xs ${
                dataState.hasFilter ? 'awake' : ''
              }`}
            >
              <span>Reset</span>
              <svg
                className="w-2.5 h-2.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center px-2 py-0.5 rounded font-mono uppercase tracking-widest cursor-pointer bg-transparent border border-border text-interactive/70 hover:text-interactive hover:bg-interactive/10 active:scale-95 text-xs"
            >
              Export
            </button>
          </div>
        </div>

        {/* River Base — zero-margin gauge as bottom border.
            Reads settledSnapshot so percentage resolves at the same instant as Ready. */}
        {settledSnapshot.total > 0 && (
          <RiverGauge
            current={settledSnapshot.count}
            total={settledSnapshot.total}
            flowState={structural.flowState}
            accent={dataState.hasFilter}
            variant="tide"
            statusLabel={structural.flowLabel}
          />
        )}
      </div>

      {/* ── Scroll Room (filter grid + badges) ─────────────────────────── */}
      <div className="flex-1">
        {columns.length > 0 ? (
          <>
            {/* Metadata Crown — invariant column badges */}
            {constants.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
                {constants.map(({ col, value }) => (
                  <span
                    key={col.name}
                    className="font-mono"
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-faint)',
                    }}
                  >
                    {col.name}{' '}
                    <span style={{ color: 'var(--color-interactive)', fontWeight: 600 }}>{value}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Variable columns — filter grid */}
            <ControlCenter
              columns={variables}
              columnStats={columnStats}
              columnCardinality={columnCardinality}
              rangeState={rangeState}
              selected={filters.selected}
              textFilters={filters.textFilters}
              onRangeDrag={filters.setRangeVisual}
              onRangeCommit={filters.commitRange}
              onToggleSelect={filters.toggleCategory}
              onClearSelect={filters.clearCategory}
              onTextChange={filters.setTextFilter}
              hasAnyFilter={dataState.hasFilter}
              constrainedStats={lifecycle.isPending ? {} : snapshot.stats}
              noResults={dataState.noResults}
              isPending={lifecycle.isPending}
              staticHistograms={staticHistograms}
              constrainedHistograms={snapshot.histograms}
              visibleColumns={visibleColumns}
              onToggleVisible={handleToggleVisible}
              profileCorrelations={profile?.correlations ?? null}
            />
          </>
        ) : (
          /* Skeleton control center */
          <div
            className="grid gap-4 p-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <div
                  className="skeleton rounded"
                  style={{ height: 10, width: `${50 + ((i * 13) % 30)}%`, marginBottom: 8 }}
                />
                <div className="skeleton rounded" style={{ height: 22, width: '100%' }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── The Vault Door (Data Drawer Header) ─────────────────────── */}
      <div
        onClick={() => {
          setDrawerState((s) => {
            if (s !== 'closed') {
              clearCache(); // closing — flush Arrow cache
              return 'closed';
            }
            fetchRange(0, WINDOW_SIZE);
            return 'opening';
          });
        }}
        className="group vault-door flex items-center justify-between px-6 py-[1lh] mx-3 shrink-0"
      >
        {/* Left: The Handle */}
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-text-faint transition-transform duration-300 group-hover:text-interactive ${drawerState !== 'closed' ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-text-muted group-hover:text-text transition-colors">
            {drawerState !== 'closed' ? 'Close Data Vault' : 'Inspect Data Vault'}
          </span>
        </div>

        {/* Right: The Lenses (Numeric / Text column toggles) */}
        {tableEligible.length > 0 && (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {[
              { label: 'Numeric', subset: tableEligible.filter((c) => isNumericType(c.type)) },
              {
                label: 'Categories',
                subset: tableEligible.filter((c) => {
                  if (isNumericType(c.type)) return false;
                  const card = columnCardinality[c.name];
                  return card && card.distinct >= 1 && card.distinct <= DROPDOWN_MAX;
                }),
              },
              {
                label: 'Text',
                subset: tableEligible.filter((c) => {
                  if (isNumericType(c.type)) return false;
                  const card = columnCardinality[c.name];
                  return !card || card.distinct > DROPDOWN_MAX;
                }),
              },
            ].map(({ label, subset }) => {
              if (subset.length === 0) return null;
              const allOn = subset.every((c) => visibleColumns.has(c.name));
              return (
                <button
                  key={label}
                  className="cursor-pointer border-none bg-transparent select-none font-mono text-xs uppercase tracking-[0.1em] px-2 py-1 rounded transition-colors"
                  style={{
                    color: allOn ? 'var(--color-interactive)' : 'var(--color-text-faint)',
                    borderBottom: allOn ? '1px solid var(--color-interactive)' : '1px solid transparent',
                  }}
                  onClick={() => {
                    setVisibleColumns((prev) => {
                      const next = new Set(prev);
                      if (allOn) {
                        subset.forEach((c) => next.delete(c.name));
                      } else {
                        subset.forEach((c) => next.add(c.name));
                      }
                      return next;
                    });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Table Drawer ───────────────────────────────────────────────────── */}
      <div
        className="flex flex-col shrink-0 overflow-hidden mx-3"
        style={{
          height: drawerState !== 'closed' ? '40vh' : '0px',
          transition: 'height 382ms cubic-bezier(0.382, 0, 0.618, 1)',
          border: drawerState !== 'closed' ? '1px solid var(--color-border-frosted)' : 'none',
          borderRadius: 'var(--radius-lg)',
        }}
        onTransitionEnd={(e) => {
          if (e.propertyName === 'height' && drawerState === 'opening') setDrawerState('open');
        }}
      >
        {/* Table header — outside scroll container, syncs horizontal scroll */}
        <div
          ref={headerRef}
          className="shrink-0 font-mono mx-3 overflow-hidden"
          style={{
            background: 'var(--color-surface-sunken)',
            ...(activeColumns.length === 0 ? { borderBottom: '2px solid var(--color-border)' } : {}),
          }}
        >
          {activeColumns.length > 0 &&
            (() => {
              const headerGroup = table.getHeaderGroups()[0];
              const activeColumnSet = new Set(activeColumns.map((c) => c.name));
              const columnMap = new Map(columns.map((c) => [c.name, c]));
              return (
                <div
                  className="flex"
                  style={{
                    minWidth: '100%',
                    width: activeTotalWidth,
                    borderBottom: '2px solid var(--color-border)',
                  }}
                >
                  {headerGroup.headers.map((header) => {
                    if (!activeColumnSet.has(header.id)) return null;
                    const c = columnMap.get(header.id)!;
                    const w = colWidths[c.name] ?? colW(c.type);
                    const sorted = header.column.getIsSorted();
                    const sortIdx = header.column.getSortIndex();
                    const multiSort = filters.sorting.length > 1;

                    return (
                      <div
                        key={header.id}
                        className="text-left font-semibold text-text-muted select-none relative group cursor-pointer"
                        style={{
                          width: w,
                          minWidth: 50,
                          flexShrink: 0,
                          padding: '3px 6px',
                          background: 'var(--color-surface-sunken)',
                          borderBottom: `2px solid ${sorted ? 'var(--color-interactive)' : 'var(--color-border)'}`,
                          fontSize: 'var(--font-size-xs)',
                        }}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-start gap-1">
                          <ColName name={c.name} />
                          <SortChevron dir={sorted || null} index={multiSort ? sortIdx : -1} />
                        </div>
                        {isNumericType(c.type) ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            className="w-full bg-transparent font-mono text-text-muted placeholder:text-text-faint focus:outline-none"
                            style={{
                              fontSize: 'calc(var(--font-size-xs) - 1px)',
                              padding: '1px 0',
                              border: 'none',
                              borderBottom: `1px solid ${
                                (() => {
                                  const r = filters.rangeOverrides[c.name];
                                  return r && r[0] === r[1];
                                })()
                                  ? 'var(--color-interactive)'
                                  : 'var(--color-border)'
                              }`,
                            }}
                            placeholder="="
                            value={(() => {
                              const r = filters.rangeOverrides[c.name];
                              return r && r[0] === r[1] ? String(r[0]) : '';
                            })()}
                            onChange={(e) => {
                              const v = e.target.value.trim();
                              if (v === '') {
                                filters.setRangeExact(c.name, null);
                              } else {
                                const n = Number(v);
                                if (!Number.isNaN(n)) filters.setRangeExact(c.name, n);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <input
                            type="text"
                            className="w-full bg-transparent font-mono text-text-muted placeholder:text-text-faint focus:outline-none"
                            style={{
                              fontSize: 'calc(var(--font-size-xs) - 1px)',
                              padding: '1px 0',
                              border: 'none',
                              borderBottom: `1px solid ${
                                filters.textFilters[c.name]?.trim()
                                  ? 'var(--color-interactive)'
                                  : 'var(--color-border)'
                              }`,
                            }}
                            placeholder="search"
                            value={filters.textFilters[c.name] ?? ''}
                            onChange={(e) => filters.setTextFilter(c.name, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <div
                          className="absolute top-0 right-0 bottom-0 opacity-0 group-hover:opacity-100"
                          style={{
                            width: 3,
                            cursor: 'col-resize',
                            background: 'var(--color-border)',
                            transition: 'opacity var(--t-fast)',
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleResizeStart(c.name, e.clientX, w);
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'var(--color-interactive)';
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'var(--color-border)';
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })()}
        </div>

        {/* Table body — scrollbar only covers data rows */}
        <div
          ref={scrollRef}
          className="overflow-auto flex-1 mx-3"
          style={{
            scrollbarGutter: 'stable',
          }}
          onScroll={(e) => {
            if (headerRef.current) headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
      >
        <div className="flex-1 min-w-0" style={{ position: 'relative' }}>
          {skeletonOverlay}

          {structural.isReady && snapshot.count > 0 && drawerState === 'open' && (
            <VirtualRows
              scrollRef={scrollRef}
              rowCount={snapshot.count}
              fetchRange={fetchRange}
              getCell={getCell}
              hasRow={hasRow}
              columns={activeColumns}
              columnStats={columnStats}
              colWidths={colWidths}
              totalWidth={activeTotalWidth}
              pulseStatus={lifecycle.phase}
              cacheGen={cacheGen}
            />
          )}

          {structural.isReady && snapshot.count === 0 && (
            <div
              className="flex flex-col items-center justify-center gap-3"
              style={{ height: '100%', minHeight: 200 }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ opacity: 0.3, color: 'var(--color-text-faint)' }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              <Text variant="dim">No records match the current filters</Text>
              <button
                onClick={filters.resetFilters}
                className="cursor-pointer bg-transparent border-none transition-colors hover:text-text"
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-faint)' }}
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

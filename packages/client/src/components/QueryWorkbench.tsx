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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDataProfile } from '../hooks/useDataProfile';
import { useDerivedState } from '../hooks/useDerivedState';
import type {
  ColumnCardinality,
  ColumnInfo,
  ColumnStats,
  QueryPhase,
  QuerySnapshot,
} from '../hooks/useFileQuery';
import { DROPDOWN_MAX, isNumericType, useFileQuery, WINDOW_SIZE } from '../hooks/useFileQuery';
import { useFilterState } from '../hooks/useFilterState';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../stores/useAppStore';
import type { StepperStep } from '../ui';
import { RiverGauge, Stepper, Text } from '../ui';

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
          color: active ? 'var(--color-cyan)' : 'inherit',
        }}
      >
        <path d="M4 0L7.5 4.5H0.5L4 0Z" />
      </svg>
      {index !== undefined && index >= 0 && (
        <span style={{ fontSize: 9, color: 'var(--color-cyan)', fontWeight: 600 }}>
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
      <span style={{ color: 'var(--color-fg-3)' }}>{parts[0]}</span>
      {parts.slice(1).map((part, i) => (
        <span key={i}>
          <span style={{ color: 'var(--color-fg-3)' }}>› </span>
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

interface ViewState {
  convergenceStep: number;
  convergenceSteps: StepperStep[];
  isReady: boolean;
  isTerminal: boolean;
  flowState: 'normal' | 'pending' | 'stalled';
  flowLabel: string | undefined;
  isPending: boolean;
  hasFilter: boolean;
  noResults: boolean;
  showSkeleton: boolean;
}

function deriveViewState(
  lifecycle: {
    phase: QueryPhase;
    error: string | null;
    queryError: Error | string | null;
    isQuerying: boolean;
  },
  snapshot: QuerySnapshot,
  isFetchingRange: boolean,
  cacheGen: number,
  filterCount: number,
): ViewState {
  const { phase, error, queryError, isQuerying } = lifecycle;

  const convergenceStep = deriveConvergenceStep(phase, isQuerying, isFetchingRange, cacheGen);

  const isTerminal = phase === 'error' || phase === 'failed' || phase === 'unavailable';
  const isReady = phase === 'ready' || phase === 'ready_background_work';

  const displayError = isTerminal ? error : undefined;
  const convergenceSteps: StepperStep[] = displayError
    ? CONVERGENCE_STEPS.map((s, i) => (i === convergenceStep ? { ...s, error: displayError } : s))
    : [...CONVERGENCE_STEPS];

  const flowState: ViewState['flowState'] = queryError
    ? 'stalled'
    : isQuerying
      ? 'pending'
      : 'normal';
  const flowLabel = queryError ? 'query failed' : undefined;

  const isPending = isQuerying || isFetchingRange;
  const hasFilter = filterCount > 0;
  const noResults = hasFilter && snapshot.count === 0;

  const showSkeleton = convergenceStep < 2 || (convergenceStep === 2 && cacheGen === 0);

  return {
    convergenceStep,
    convergenceSteps,
    isReady,
    isTerminal,
    flowState,
    flowLabel,
    isPending,
    hasFilter,
    noResults,
    showSkeleton,
  };
}

// ── useRetainedState — bridges network gaps with a single law ─────────────────
// Value is remembered across renders. Cleared when clearCondition fires.
// Bridges the gap when value is temporarily undefined during a query.

function useRetainedState<T>(value: T | undefined, clearCondition: boolean): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (clearCondition) {
    ref.current = undefined;
  } else if (value !== undefined) {
    ref.current = value;
  }
  return value ?? ref.current;
}

// ── DistributionPlot ──────────────────────────────────────────────────────────
// Ghost mask clip is driven purely by inherited CSS vars (--lo, --hi) from the
// parent track container — zero JS overhead, zero imperative handles.

const DistributionPlot = memo(
  function DistributionPlot({
    staticBins,
    height,
    pending,
  }: {
    staticBins: number[];
    height: number;
    pending?: boolean;
  }) {
    const n = staticBins.length;
    if (n === 0) return null;

    const staticMax = useMemo(() => Math.max(...staticBins, 1), [staticBins]);
    const binW = 100 / n;

    const clipId = useRef(`ghost-mask-${Math.random().toString(36).slice(2, 8)}`).current;

    // Static rects — full-height bars scaled by scaleY, no main-thread animation.
    const staticRects = useMemo(
      () =>
        staticBins.map((v, i) => (
          <rect
            key={i}
            x={i * binW}
            y={0}
            width={binW}
            height={height}
            fill="var(--color-cyan)"
            style={{ transformOrigin: 'bottom', transform: `scaleY(${v / staticMax})` }}
          />
        )),
      [staticBins, staticMax, height, binW],
    );

    // Dynamic rects — stable DOM, driven by CSS custom properties.
    // Each bar reads its scale from --dyn-N, written imperatively by syncHistogram.
    // React never re-renders these during drag — only the CSS vars change.
    // transition: transform fires on the compositor thread when vars update.
    const dynamicRects = useMemo(
      () =>
        Array.from({ length: n }, (_, i) => (
          <rect
            key={i}
            x={i * binW}
            y={0}
            width={binW}
            height={height}
            fill="var(--color-cyan)"
            opacity={0.45}
            style={{
              transformOrigin: 'bottom',
              transform: `scaleY(var(--dyn-${i}, 0))`,
              transition: 'transform 300ms cubic-bezier(0.382, 0, 0.618, 1)',
            }}
          />
        )),
      [n, height, binW], // No data dependency — bars are stable, CSS vars drive scale
    );

    return (
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              y="0"
              height={height}
              style={
                {
                  x: 'calc(var(--lo) * 1%)',
                  width: 'max(0px, calc((var(--hi) - var(--lo)) * 1%))',
                } as React.CSSProperties
              }
            />
          </clipPath>
        </defs>

        {/* Static layer — absolute reference shape, never clipped */}
        <g opacity={0.12}>{staticRects}</g>

        {/* Dynamic layer — always mounted. Bars driven by CSS vars (--dyn-N)
           written by syncHistogram. No React re-render during drag. */}
        <g
          clipPath={`url(#${clipId})`}
          style={{
            opacity: pending ? 0.5 : 1,
            transition: 'opacity 200ms',
            animation: pending ? 'distPlotBreath 1.5s ease-in-out infinite' : 'none',
          }}
        >
          {dynamicRects}
        </g>
      </svg>
    );
  },
  // Re-render only when static data or pending changes.
  // Dynamic bars are driven by CSS vars — never trigger re-render.
  (prev, next) =>
    prev.staticBins === next.staticBins &&
    prev.height === next.height &&
    prev.pending === next.pending,
);

// ── EditableNumber ────────────────────────────────────────────────────────────

function EditableNumber({
  value,
  min,
  max,
  isFloat,
  color,
  onCommit,
  align = 'left',
}: {
  value: number;
  min: number;
  max: number;
  isFloat: boolean;
  color: string;
  onCommit: (v: number) => void;
  align?: 'left' | 'right';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const display = isFloat ? value.toFixed(2) : value.toLocaleString();

  const commit = () => {
    const raw = draft.replace(/,/g, '').trim();
    const parsed = Number(raw);
    if (!isNaN(parsed) && raw !== '') {
      const clamped = Math.min(max, Math.max(min, parsed));
      onCommit(clamped);
    }
    setEditing(false);
  };

  // Keep commas live as the user types
  const handleChange = (raw: string) => {
    const stripped = raw.replace(/,/g, '');
    if (stripped === '' || stripped === '-' || stripped === '.') {
      setDraft(stripped);
      return;
    }
    const parsed = Number(stripped);
    if (!isNaN(parsed)) {
      setDraft(isFloat ? stripped : parsed.toLocaleString());
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="font-mono bg-transparent border-none outline-none"
        style={{
          fontSize: 'inherit',
          color: 'var(--color-cyan)',
          width: `${Math.max(display.length, 4) + 1}ch`,
          textAlign: align,
          padding: 0,
          margin: 0,
          borderBottom: '1px solid var(--color-cyan)',
        }}
        autoFocus
      />
    );
  }

  return (
    <span
      onClick={() => {
        setDraft(display);
        setEditing(true);
      }}
      className="cursor-text"
      style={{
        color,
        borderBottom: '1px dashed transparent',
        transition: 'border-color var(--t-fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-fg-3)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'transparent';
      }}
      title="Click to edit"
    >
      {display}
    </span>
  );
}

// ── Optimistic Histogram Projection ───────────────────────────────────────────
// Project the constrained histogram locally from static bins + thumb positions.
// Zeroes bins outside the selected range; DistributionPlot's activeMax rescales
// the local peak to full height. Valid for the active column only — cross-column
// effects require the server. Replaced by real constrained histogram on arrival.

function projectHistogram(
  staticBins: number[],
  lo: number,
  hi: number,
  min: number,
  max: number,
  conMin?: number,
  conMax?: number,
): number[] {
  const n = staticBins.length;
  const range = max - min || 1;
  const toBin = (v: number) =>
    Math.max(0, Math.min(n - 1, Math.floor(((v - min) / range) * n)));
  const binLo = toBin(lo);
  const binHi = toBin(hi);

  // Intersect the selected range with the constrained data extent.
  // Bins outside [conMin, conMax] are OOB — the cross-filtered query will return
  // 0 for them, so including them in the projection would inflate the estimate.
  const conBinLo = conMin !== undefined ? toBin(conMin) : 0;
  const conBinHi = conMax !== undefined ? toBin(conMax) : n - 1;
  const effectiveLo = Math.max(binLo, conBinLo);
  const effectiveHi = Math.min(binHi, conBinHi);

  // Pass 1: find local maximum within the effective (in-bounds) range
  let localMax = 0;
  for (let i = effectiveLo; i <= effectiveHi; i++) {
    if (staticBins[i] > localMax) localMax = staticBins[i];
  }
  if (localMax === 0) return new Array<number>(n).fill(0);
  // Pass 2: rescale visible bins so local peak = global peak of static distribution
  const globalMax = Math.max(...staticBins, 1);
  const projected = new Array<number>(n).fill(0);
  for (let i = effectiveLo; i <= effectiveHi; i++) {
    projected[i] = (staticBins[i] / localMax) * globalMax;
  }
  return projected;
}

// ── Void Detector ─────────────────────────────────────────────────────────────
// If the drag delta swept only through histogram bins with 0 counts,
// the query result is identical — skip the network request.

function hasDataInDelta(
  oldVal: number,
  newVal: number,
  min: number,
  max: number,
  histogram: number[],
): boolean {
  const n = histogram.length;
  const range = max - min || 1;
  const toBin = (v: number) =>
    Math.max(0, Math.min(n - 1, Math.floor(((v - min) / range) * (n - 1))));
  const a = toBin(Math.min(oldVal, newVal));
  const b = toBin(Math.max(oldVal, newVal));
  for (let i = a; i <= b; i++) {
    if (histogram[i] > 0) return true;
  }
  return false;
}

// ── RangeSlider ───────────────────────────────────────────────────────────────

// Stable color constants — module-level so useCallback deps never churn
const AMBER_COLOR = 'var(--color-amber)';
const AMBER_GLOW = 'oklch(0.750 0.185 60 / 0.28)';
const CYAN_COLOR = 'var(--color-cyan)';
const CYAN_GLOW = 'oklch(0.750 0.180 195 / 0.25)';

function RangeSlider({
  name,
  min,
  max,
  low,
  high,
  onDrag,
  onCommit,
  constrainedMin,
  constrainedMax,
  pending,
  staticHistogram,
  dynamicHistogram,
}: {
  name: string;
  min: number;
  max: number;
  low: number;
  high: number;
  onDrag: (name: string, lo: number, hi: number) => void;
  onCommit: (name: string, lo: number, hi: number) => void;
  constrainedMin?: number;
  constrainedMax?: number;
  pending?: boolean;
  staticHistogram?: number[];
  dynamicHistogram?: number[];
}) {
  // ── Slider lifecycle state machine ────────────────────────────────────────
  // Five mutually exclusive phases. No boolean flags, no flag intersections.
  //
  //  idle ──pointerDown──► dragging ──pointerUp(data)──► dropped ──pending──► querying ──!pending──► idle
  //                                  └──pointerUp(void)──► idle
  //
  //  Spectator = phase is idle while pending is true (this slider didn't cause the query).
  //
  type SliderPhase = 'idle' | 'dragging' | 'dropped' | 'querying';
  const [phase, setPhaseRaw] = useState<SliderPhase>('idle');
  // isPanning is gesture sub-type only (cursor style, pan window pointer events).
  // It does not affect the lifecycle phase — both thumb-drag and pan are 'dragging'.
  const [isPanning, setIsPanning] = useState(false);

  // Drag context — captured at pointerDown, sealed for the entire actor cycle.
  // Contains everything the drag needs from the outside world so that concurrent
  // server responses can't mutate the visual state mid-gesture.
  const dragCtxRef = useRef<{
    lo: number;
    hi: number;
    conMin: number | undefined;
    conMax: number | undefined;
  } | null>(null);

  // State machine transition — owns drag context lifecycle.
  // Context enters on 'dragging', exits on 'idle'. No leaks.
  const setPhase = useCallback((next: SliderPhase) => {
    if (next === 'idle') dragCtxRef.current = null;
    setPhaseRaw(next);
  }, []);
  const trackRef = useRef<HTMLDivElement>(null); // outer gauge — CSS var host
  const sliderRef = useRef<HTMLDivElement>(null); // inner track — pixel measurements
  const panStartRef = useRef<{ x: number; lo: number; hi: number; trackW: number } | null>(null);
  const lowInputRef = useRef<HTMLInputElement>(null);
  const highInputRef = useRef<HTMLInputElement>(null);

  // Stable refs — global listeners and syncPosition always see latest values
  const lowRef = useRef(low);
  const highRef = useRef(high);
  lowRef.current = low;
  highRef.current = high;

  const range = max - min || 1;
  const full = low <= min && high >= max;

  // Bridge network gaps: retain constrained bounds during queries, clear on reset.
  const activeConMin = useRetainedState(constrainedMin, full);
  const activeConMax = useRetainedState(constrainedMax, full);
  const isFloat = !Number.isInteger(min) || !Number.isInteger(max);
  const step = isFloat ? ('any' as const) : 1;

  const epsilon = range * 0.001;

  // ── Sealed constrained bounds ──────────────────────────────────────────────
  // During the actor cycle, use the constrained bounds captured at drag start.
  // This seals the amber predicate against concurrent server responses.
  // Outside the actor cycle, use the live reactive values.
  const dragCtx = dragCtxRef.current;
  const sealedConMin = dragCtx ? dragCtx.conMin : activeConMin;
  const sealedConMax = dragCtx ? dragCtx.conMax : activeConMax;
  const hasConData = sealedConMin !== undefined && sealedConMax !== undefined;

  // Amber predicate — frozen at drag start, impossible to flip mid-gesture.
  const hadAmberLo = hasConData && dragCtx != null && dragCtx.lo < sealedConMin! - epsilon;
  const hadAmberHi = hasConData && dragCtx != null && dragCtx.hi > sealedConMax! + epsilon;
  const projConMin = hadAmberLo ? sealedConMin : undefined;
  const projConMax = hadAmberHi ? sealedConMax : undefined;
  const projectedHistogram = useMemo(
    () =>
      staticHistogram && !full
        ? projectHistogram(staticHistogram, low, high, min, max, projConMin, projConMax)
        : undefined,
    [staticHistogram, low, high, min, max, full, projConMin, projConMax],
  );

  // ── Phase derivation ───────────────────────────────────────────────────────
  // Inline settle: if we were querying and pending just ended, treat as idle on
  // THIS render — no extra render, no color flash.
  const effectivePhase: SliderPhase = phase === 'querying' && !pending ? 'idle' : phase;

  const isActor    = effectivePhase === 'dragging' || effectivePhase === 'dropped' || effectivePhase === 'querying';
  const isSpectator = effectivePhase === 'idle' && !!pending;
  const settled    = !isActor && !isSpectator; // idle + !pending = fresh server data
  const isDragging = effectivePhase === 'dragging';

  // Rendering rules derived from exactly one source of truth:
  //   isActor     → projected histogram, unconstrained track, ghost OOB (opacity 0)
  //   isSpectator → retained histogram,  constrained track,  ghost OOB (opacity 0)
  //   settled     → dynamic  histogram,  constrained track,  amber OOB if outside bounds
  const conLoPct = hasConData ? Math.max(0, ((sealedConMin! - min) / range) * 100) : 0;
  const conHiPct = hasConData ? Math.min(100, ((sealedConMax! - min) / range) * 100) : 100;

  // ── Imperative engine — drives all track + thumb visuals at 60fps ──────────
  // React only sees the final values on pointerUp.  Between pointer events
  // every pixel is moved by CSS-variable writes on the container DOM node.

  // Position-only: writes --lo, --hi, and syncs input values. Nothing else.
  // Stable identity — only depends on range math, never on constrained bounds.
  const syncPosition = useCallback(
    (loVal: number, hiVal: number) => {
      const el = trackRef.current;
      if (!el) return;
      el.style.setProperty('--lo', String(((loVal - min) / range) * 100));
      el.style.setProperty('--hi', String(((hiVal - min) / range) * 100));
      const loIn = lowInputRef.current;
      const hiIn = highInputRef.current;
      if (loIn && Math.abs(Number(loIn.value) - loVal) > 1e-7) loIn.value = String(loVal);
      if (hiIn && Math.abs(Number(hiIn.value) - hiVal) > 1e-7) hiIn.value = String(hiVal);
    },
    [min, range],
  );

  // Full settle write: OOB vars + thumb colors. Called ONLY when data settles.
  // Reads live activeConMin/activeConMax — the server's word is final.
  const syncOob = useCallback((clear?: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    const oobLo = !clear && activeConMin !== undefined && activeConMax !== undefined && lowRef.current < activeConMin - epsilon;
    const oobHi = !clear && activeConMin !== undefined && activeConMax !== undefined && highRef.current > activeConMax + epsilon;
    el.style.setProperty('--oob-lo', oobLo ? '0.5' : '0');
    el.style.setProperty('--oob-hi', oobHi ? '0.5' : '0');
    const loIn = lowInputRef.current;
    const hiIn = highInputRef.current;
    if (loIn) {
      loIn.style.setProperty('--range-thumb-color', oobLo ? AMBER_COLOR : CYAN_COLOR);
      loIn.style.setProperty('--range-thumb-glow', oobLo ? AMBER_GLOW : CYAN_GLOW);
      loIn.style.opacity = String(oobLo ? 0.9 : 1);
    }
    if (hiIn) {
      hiIn.style.setProperty('--range-thumb-color', oobHi ? AMBER_COLOR : CYAN_COLOR);
      hiIn.style.setProperty('--range-thumb-glow', oobHi ? AMBER_GLOW : CYAN_GLOW);
      hiIn.style.opacity = String(oobHi ? 0.9 : 1);
    }
  }, [activeConMin, activeConMax, epsilon]);

  // ── Imperative histogram — drives dynamic bar scales via CSS vars ──────────
  // Same pattern as syncPosition: direct DOM writes, zero React reconciliation.
  // Writes --dyn-0..N on trackRef, read by DistributionPlot's stable rects.
  const syncHistogram = useCallback(
    (bins: number[]) => {
      const el = trackRef.current;
      if (!el) return;
      let mx = 0;
      for (let i = 0; i < bins.length; i++) {
        if (bins[i] > mx) mx = bins[i];
      }
      if (mx === 0) mx = 1;
      for (let i = 0; i < bins.length; i++) {
        el.style.setProperty(`--dyn-${i}`, String(bins[i] / mx));
      }
    },
    [],
  );

  // Position sync — runs when React state catches up (non-drag only).
  // ── Single sync — useLayoutEffect fires BEFORE paint ──────────────────────
  // No flash: DOM is corrected synchronously after React commit, before any
  // pixel is drawn. One effect, one timing, no desync.
  // During actor cycle: skip entirely — drag handlers own the DOM.
  useLayoutEffect(() => {
    // Phase bookkeeping — keep state consistent with effectivePhase.
    if (pending && phase === 'dropped') setPhase('querying');
    else if (!pending && phase === 'querying') setPhase('idle');

    // Actor cycle: drag handlers own position. Zero OOB — amber cannot
    // coexist with an active drag. syncOob at settle restores them.
    if (isActor) {
      syncOob(true);
      return;
    }

    // Position
    syncPosition(low, high);

    // Constrained bounds CSS vars
    const el = trackRef.current;
    if (el) {
      el.style.setProperty('--c-lo', String(conLoPct));
      el.style.setProperty('--c-hi', String(conHiPct));
    }

    // OOB + thumb colors — only on settle (server's word is final)
    if (settled) syncOob();

    // Histogram
    if (!isSpectator) {
      const bins = dynamicHistogram ?? projectedHistogram ?? staticHistogram;
      if (bins) syncHistogram(bins);
    }
  }, [low, high, isActor, isSpectator, settled, pending, phase,
      syncPosition, syncOob, syncHistogram, conLoPct, conHiPct,
      projectedHistogram, dynamicHistogram, staticHistogram, setPhase]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleClipToReality = () => {
    if (activeConMin !== undefined && activeConMax !== undefined) {
      onDrag(name, activeConMin, activeConMax);
      onCommit(name, activeConMin, activeConMax);
    }
  };

  const handleDragStart = () => {
    setPhase('dragging');
    dragCtxRef.current = { lo: lowRef.current, hi: highRef.current, conMin: settled ? activeConMin : undefined, conMax: settled ? activeConMax : undefined };
  };

  const handleDragEnd = () => {
    // Read the absolute DOM truth — onChange may lag behind the final pixel
    const actualLo = lowInputRef.current ? Number(lowInputRef.current.value) : lowRef.current;
    const actualHi = highInputRef.current ? Number(highInputRef.current.value) : highRef.current;

    // Hard sync — refs, CSS vars, and inputs all agree before anything else
    lowRef.current = actualLo;
    highRef.current = actualHi;
    syncPosition(actualLo, actualHi);

    setPhase('dropped');
    // Void detector: if the drag delta swept only through empty bins, skip the query
    const start = dragCtxRef.current;
    if (start && staticHistogram && staticHistogram.length > 0) {
      const loChanged = actualLo !== start.lo;
      const hiChanged = actualHi !== start.hi;
      const loDelta = loChanged && hasDataInDelta(start.lo, actualLo, min, max, staticHistogram);
      const hiDelta = hiChanged && hasDataInDelta(start.hi, actualHi, min, max, staticHistogram);
      if ((loChanged || hiChanged) && !loDelta && !hiDelta) {
        setPhase('idle'); // void drag — no query coming
        return;
      }
    }
    onDrag(name, actualLo, actualHi);
    onCommit(name, actualLo, actualHi);
  };

  // ── Track Panning — grab between thumbs to slide the whole window ──────────

  const handlePanStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const track = sliderRef.current;
      if (!track) return;
      const trackW = track.getBoundingClientRect().width;
      const lo = lowRef.current;
      const hi = highRef.current;
      panStartRef.current = { x: e.clientX, lo, hi, trackW };
      dragCtxRef.current = { lo, hi, conMin: settled ? activeConMin : undefined, conMax: settled ? activeConMax : undefined };
      setPhase('dragging');
      setIsPanning(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const capturedTarget = e.target as HTMLElement;
      const capturedPointerId = e.pointerId;

      const onMove = (ev: PointerEvent) => {
        const s = panStartRef.current;
        if (!s) return;
        const deltaPx = ev.clientX - s.x;
        const deltaVal = (deltaPx / s.trackW) * range;
        const span = s.hi - s.lo;
        let newLo = s.lo + deltaVal;
        let newHi = s.hi + deltaVal;
        if (newLo < min) {
          newLo = min;
          newHi = min + span;
        } else if (newHi > max) {
          newHi = max;
          newLo = max - span;
        }
        lowRef.current = newLo;
        highRef.current = newHi;
        syncPosition(newLo, newHi);
        if (staticHistogram) syncHistogram(projectHistogram(staticHistogram, newLo, newHi, min, max, projConMin, projConMax));
        onDrag(name, newLo, newHi);
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try {
          capturedTarget.releasePointerCapture(capturedPointerId);
        } catch {}
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        panStartRef.current = null;
        setIsPanning(false);
        setPhase('dropped');
        const curLo = lowRef.current;
        const curHi = highRef.current;
        const start = dragCtxRef.current;
        if (start && staticHistogram && staticHistogram.length > 0) {
          const loChanged = curLo !== start.lo;
          const hiChanged = curHi !== start.hi;
          const loDelta = loChanged && hasDataInDelta(start.lo, curLo, min, max, staticHistogram);
          const hiDelta = hiChanged && hasDataInDelta(start.hi, curHi, min, max, staticHistogram);
          if ((loChanged || hiChanged) && !loDelta && !hiDelta) {
            setPhase('idle'); // void pan — no query coming
            return;
          }
        }
        onDrag(name, curLo, curHi);
        onCommit(name, curLo, curHi);
      };

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [name, min, max, range, onDrag, onCommit, staticHistogram, syncPosition, syncHistogram, projConMin, projConMax],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const PLOT_H = 56;

  return (
    <div
      ref={trackRef}
      style={{
        background: 'oklch(0.13 0.01 240 / 0.5)',
        borderRadius: 6,
        padding: '6px 8px 4px',
      }}
    >
      {staticHistogram && staticHistogram.length > 0 && (
        <div className="relative" style={{ height: PLOT_H, marginBottom: 2 }}>
          <DistributionPlot
            staticBins={staticHistogram}
            height={PLOT_H}
            pending={pending}
          />
        </div>
      )}
      <div ref={sliderRef} className="relative" style={{ height: 20 }}>
        {/* Ghost base — full width reference line */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full w-full"
          style={{ height: 2, background: CYAN_COLOR, opacity: 0.1 }}
        />

        {/* Left amber void — thumb → density boundary (CSS-driven) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={
            {
              left: 'calc(var(--lo) * 1%)',
              width: 'max(0%, calc((var(--c-lo) - var(--lo)) * 1%))',
              height: 3,
              background: AMBER_COLOR,
              opacity: 'var(--oob-lo)',
              boxShadow: `0 0 6px ${AMBER_GLOW}`,
              transition: 'opacity var(--t-fast)',
            } as CSSProperties
          }
        />

        {/* Right amber void — density boundary → thumb (CSS-driven) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={
            {
              left: 'calc(var(--c-hi) * 1%)',
              width: 'max(0%, calc((var(--hi) - var(--c-hi)) * 1%))',
              height: 3,
              background: AMBER_COLOR,
              opacity: 'var(--oob-hi)',
              boxShadow: `0 0 6px ${AMBER_GLOW}`,
              transition: 'opacity var(--t-fast)',
            } as CSSProperties
          }
        />

        {/* Constrained data extent — double-click to clip */}
        {hasConData && !isActor && (
          <div
            className="absolute top-1/2 -translate-y-1/2 rounded-full"
            title="Double-click to clip handles to this range"
            onDoubleClick={handleClipToReality}
            style={
              {
                left: 'calc(var(--c-lo) * 1%)',
                width: 'calc(max(0, var(--c-hi) - var(--c-lo)) * 1%)',
                height: 4,
                background: CYAN_COLOR,
                opacity: isSpectator ? 0.15 : 0.4,
                cursor: 'pointer',
                transition: 'opacity var(--t-fast)',
              } as CSSProperties
            }
          />
        )}

        {/* Cyan truth track — only where data exists between thumbs */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={
            {
              left: hasConData && (settled || hadAmberLo)
                ? 'max(calc(var(--lo) * 1%), calc(var(--c-lo) * 1%))'
                : 'calc(var(--lo) * 1%)',
              right: hasConData && (settled || hadAmberHi)
                ? 'max(calc((100 - var(--hi)) * 1%), calc((100 - var(--c-hi)) * 1%))'
                : 'calc((100 - var(--hi)) * 1%)',
              height: 2,
              background: CYAN_COLOR,
              opacity: full ? 0.1 : isActor ? (hadAmberLo || hadAmberHi ? 0.4 : 1) : isSpectator ? 0.15 : hasConData ? 0.4 : 1,
            } as CSSProperties
          }
        />

        {/* Pannable window — grab between thumbs to slide the whole range */}
        {!full && (
          <div
            style={
              {
                position: 'absolute',
                top: 0,
                left: 'calc(var(--lo) * 1%)',
                width: 'calc(max(0, var(--hi) - var(--lo)) * 1%)',
                height: '100%',
                zIndex: 2,
                cursor: isPanning ? 'grabbing' : 'grab',
                pointerEvents: isDragging ? 'none' : undefined,
              } as CSSProperties
            }
            onPointerDown={handlePanStart}
          />
        )}

        <input
          ref={lowInputRef}
          type="range"
          className="range-thumb range-low absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min}
          max={max}
          step={step}
          defaultValue={low}
          onPointerDown={handleDragStart}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), highRef.current);
            lowRef.current = v;
            syncPosition(v, highRef.current);
            if (staticHistogram) syncHistogram(projectHistogram(staticHistogram, v, highRef.current, min, max, projConMin, projConMax));
            onDrag(name, v, highRef.current);
          }}
        />
        <input
          ref={highInputRef}
          type="range"
          className="range-thumb range-high absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min}
          max={max}
          step={step}
          defaultValue={high}
          onPointerDown={handleDragStart}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), lowRef.current);
            highRef.current = v;
            syncPosition(lowRef.current, v);
            if (staticHistogram) syncHistogram(projectHistogram(staticHistogram, lowRef.current, v, min, max, projConMin, projConMax));
            onDrag(name, lowRef.current, v);
          }}
        />
      </div>
      <div
        className="flex justify-between font-mono mt-0.5"
        style={{ fontSize: 'var(--font-size-xs)' }}
      >
        <EditableNumber
          value={low}
          min={min}
          max={high}
          isFloat={isFloat}
          color={settled && hasConData && low < sealedConMin! - epsilon ? 'var(--color-amber)' : full ? 'var(--color-fg-3)' : 'var(--color-fg-2)'}
          onCommit={(v) => {
            onDrag(name, v, high);
            onCommit(name, v, high);
          }}
        />
        <EditableNumber
          value={high}
          min={low}
          max={max}
          isFloat={isFloat}
          color={settled && hasConData && high > sealedConMax! + epsilon ? 'var(--color-amber)' : full ? 'var(--color-fg-3)' : 'var(--color-fg-2)'}
          onCommit={(v) => {
            onDrag(name, low, v);
            onCommit(name, low, v);
          }}
          align="right"
        />
      </div>
    </div>
  );
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
          className="w-full flex items-center justify-between gap-1.5 rounded-sm border border-line px-2 py-1 cursor-pointer bg-transparent transition-colors"
          style={{ fontSize: 'var(--font-size-xs)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--color-base)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <span
            className="truncate"
            style={{ color: count > 0 ? 'var(--color-fg)' : 'var(--color-fg-3)' }}
          >
            {count > 0 ? `${count} of ${values.length}` : 'All'}
          </span>
          {count > 0 ? (
            <span
              className="shrink-0 rounded px-1 font-mono font-bold tabular-nums"
              style={{
                fontSize: 'var(--font-size-xs)',
                background: 'var(--color-cyan)',
                color: 'var(--color-void)',
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
          className="border border-line shadow-lg rounded-md z-popover animate-fade-in"
          style={{
            minWidth: 'var(--radix-popover-trigger-width)',
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--color-void)',
          }}
        >
          {count > 0 && (
            <button
              className="block w-full text-left px-2 py-1.5 font-mono cursor-pointer bg-transparent border-none"
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-fg-3)',
                borderBottom: '1px solid var(--color-line)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-base)';
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
                e.currentTarget.style.background = 'var(--color-base)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(v)}
                onChange={() => onToggle(v)}
                style={{ accentColor: 'var(--color-cyan)', flexShrink: 0 }}
              />
              <span
                className="font-mono truncate"
                style={{
                  color: selected.has(v) ? 'var(--color-cyan)' : 'var(--color-fg)',
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
  isQuerying,
  staticHistograms,
  constrainedHistograms,
  visibleColumns,
  onToggleVisible,
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
  isQuerying: boolean;
  staticHistograms: Record<string, number[]>;
  constrainedHistograms: Record<string, number[]>;
  visibleColumns: Set<string>;
  onToggleVisible: (name: string) => void;
}) {
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

  const renderColumnCard = (c: ColumnInfo) => {
    const isNum = isNumericType(c.type);
    const stats = columnStats[c.name];
    const card = columnCardinality[c.name];
    const sel = selected[c.name] ?? new Set<string>();
    const hasCard = card && card.distinct >= 1 && card.distinct <= DROPDOWN_MAX;
    const active = isNum
      ? !!(
          rangeState[c.name] &&
          stats &&
          (rangeState[c.name][0] > stats.min || rangeState[c.name][1] < stats.max)
        )
      : hasCard
        ? sel.size > 0
        : !!textFilters[c.name]?.trim();

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
                ? 'var(--color-cyan)'
                : visibleColumns.has(c.name)
                  ? 'var(--color-fg-2)'
                  : 'var(--color-fg-3)',
              borderBottom: visibleColumns.has(c.name)
                ? '1px solid var(--color-cyan)'
                : '1px dashed var(--color-fg-3)',
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

        {isNum ? (
          !stats ? (
            /* Schema says numeric but stats haven't hydrated — skeleton track */
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
                color: 'var(--color-fg-3)',
                fontStyle: 'italic',
              }}
            >
              {Number.isInteger(stats.min) ? stats.min.toLocaleString() : stats.min.toFixed(2)}{' '}
              (constant)
            </span>
          ) : (
            <RangeSlider
              name={c.name}
              min={stats.min}
              max={stats.max}
              low={rangeState[c.name]?.[0] ?? stats.min}
              high={rangeState[c.name]?.[1] ?? stats.max}
              constrainedMin={hasAnyFilter ? constrainedStats[c.name]?.min : undefined}
              constrainedMax={hasAnyFilter ? constrainedStats[c.name]?.max : undefined}
              pending={isQuerying}
              onDrag={onRangeDrag}
              onCommit={onRangeCommit}
              staticHistogram={staticHistograms[c.name]}
              dynamicHistogram={hasAnyFilter ? constrainedHistograms[c.name] : undefined}
            />
          )
        ) : hasCard ? (
          card.values.length === 1 ? (
            <span
              className="font-mono"
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-fg-3)',
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
        ) : !isNum ? (
          <input
            className="w-full bg-transparent border border-line rounded-sm text-fg-2 font-mono placeholder:text-fg-3 focus:outline-none"
            style={{
              fontSize: 'var(--font-size-xs)',
              padding: '3px 6px',
              borderColor: textFilters[c.name]?.trim() ? 'var(--color-cyan)' : undefined,
              transition: 'border-color var(--t-fast)',
            }}
            placeholder="Search…"
            value={textFilters[c.name] ?? ''}
            onChange={(e) => onTextChange(c.name, e.target.value)}
            spellCheck={false}
          />
        ) : null}
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
                  color: sel.size > 0 ? 'var(--color-cyan)' : 'var(--color-fg-3)',
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
        {numerics.length > 0 && (
          <div
            className="grid gap-4 content-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {numerics.map(renderColumnCard)}
          </div>
        )}
        {texts.length > 0 && (
          <div
            className="grid gap-4 content-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {texts.map(renderColumnCard)}
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
                        borderBottom: '1px solid var(--color-line)',
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
                      borderBottom: '1px solid var(--color-line)',
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
                      <span style={{ color: 'var(--color-fg-3)', fontStyle: 'italic' }}>—</span>
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
  onExport,
  onProgress,
}: {
  fileId: string;
  filename?: string;
  onExport?: () => void;
  onProgress?: (config: { steps: StepperStep[]; active: number } | null) => void;
}) {
  // ── Profile enrichment — early access for filter state ──
  const cachedProfile = useAppStore((s) => s.fileProfiles[fileId]?.dataProfile ?? null);

  const { profile } = useDataProfile(
    cachedProfile?.schema?.length ? fileId : null,
    ['columnStats', 'cardinality', 'charLengths', 'initialRows', 'histograms'],
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

  // ── Query engine — reacts to filter intent automatically ──
  const { lifecycle, snapshot, store } = useFileQuery(fileId, filters.specs, filters.sortSpecs);
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

  // ── View derivation ────────────────────────────────────────────────────────
  const viewState = useMemo(
    () => deriveViewState(lifecycle, snapshot, isFetchingRange, cacheGen, filters.specs.length),
    [
      lifecycle.phase,
      lifecycle.error,
      lifecycle.queryError,
      lifecycle.isQuerying,
      isFetchingRange,
      cacheGen,
      filters.specs.length,
      snapshot.count,
    ],
  );

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
    onProgress?.({ steps: viewState.convergenceSteps, active: viewState.convergenceStep });
  }, [viewState.convergenceStep, viewState.isTerminal, viewState.convergenceSteps]);

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

  // ── Drawer & column visibility state ────────────────────────────────────────
  const [drawerState, setDrawerState] = useState<'closed' | 'opening' | 'open'>('closed');

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
                    borderBottom: '1px solid var(--color-line)',
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
          background: 'var(--color-void)',
          opacity: viewState.showSkeleton ? 1 : 0,
          pointerEvents: viewState.showSkeleton ? 'auto' : 'none',
        }}
      >
        {viewState.showSkeleton && skeletonGrid}
      </div>
    ),
    [viewState.showSkeleton, skeletonGrid],
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

  if (viewState.isTerminal) return null;

  return (
    <div
      className="flex flex-col flex-1"
      style={{
        background: 'var(--color-void)',
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
                  <span className="text-lg font-bold tracking-tight text-fg truncate" title={filename}>{stem}</span>
                  <span className={`text-lg font-normal text-cyan/70 overflow-hidden transition-[opacity,max-width] duration-300 ease-[cubic-bezier(0.382,0,0.618,1)] ${showExt ? 'opacity-100 max-w-40' : 'opacity-0 max-w-0'}`}>{ext}</span>
                </div>
              </>
            )}
          </div>

          {/* Pillar 2: Stepper + Status */}
          <div className="flex flex-col items-center">
            <Stepper steps={viewState.convergenceSteps} active={viewState.convergenceStep} />
          </div>

          {/* Pillar 3: Command Cluster */}
          <div className="flex justify-end items-center gap-2">
            <button
              type="button"
              onClick={filters.resetFilters}
              className={`ghost flex items-center gap-1 px-2 py-0.5 rounded font-mono uppercase tracking-widest cursor-pointer bg-transparent border-none text-cyan/70 hover:text-cyan hover:bg-cyan/10 active:scale-95 text-xs ${
                viewState.hasFilter ? 'awake' : ''
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
            {onExport && (
              <button
                type="button"
                onClick={onExport}
                className="flex items-center px-2 py-0.5 rounded font-mono uppercase tracking-widest cursor-pointer bg-transparent border border-line text-cyan/70 hover:text-cyan hover:bg-cyan/10 active:scale-95 text-xs"
              >
                Export
              </button>
            )}
          </div>
        </div>

        {/* River Base — zero-margin gauge as bottom border */}
        {snapshot.total > 0 && (
          <RiverGauge
            current={snapshot.count}
            total={snapshot.total}
            flowState={viewState.flowState}
            accent={viewState.hasFilter}
            variant="tide"
            statusLabel={viewState.flowLabel}
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
                      color: 'var(--color-fg-3)',
                    }}
                  >
                    {col.name}{' '}
                    <span style={{ color: 'var(--color-cyan)', fontWeight: 600 }}>{value}</span>
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
              hasAnyFilter={viewState.hasFilter}
              constrainedStats={snapshot.stats}
              noResults={viewState.noResults}
              isQuerying={lifecycle.isQuerying}
              staticHistograms={staticHistograms}
              constrainedHistograms={snapshot.histograms}
              visibleColumns={visibleColumns}
              onToggleVisible={handleToggleVisible}
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
            className={`w-4 h-4 text-fg-3 transition-transform duration-300 group-hover:text-cyan ${drawerState !== 'closed' ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-fg-2 group-hover:text-fg transition-colors">
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
                    color: allOn ? 'var(--color-cyan)' : 'var(--color-fg-3)',
                    borderBottom: allOn ? '1px solid var(--color-cyan)' : '1px solid transparent',
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
          border: drawerState !== 'closed' ? '1px solid oklch(1 0 0 / 0.10)' : 'none',
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
            background: 'var(--color-void)',
            ...(activeColumns.length === 0 ? { borderBottom: '2px solid var(--color-line)' } : {}),
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
                    borderBottom: '2px solid var(--color-line)',
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
                        className="text-left font-semibold text-fg-2 select-none relative group cursor-pointer"
                        style={{
                          width: w,
                          minWidth: 50,
                          flexShrink: 0,
                          padding: '3px 6px',
                          background: 'var(--color-void)',
                          borderBottom: `2px solid ${sorted ? 'var(--color-cyan)' : 'var(--color-line)'}`,
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
                            className="w-full bg-transparent font-mono text-fg-2 placeholder:text-fg-3 focus:outline-none"
                            style={{
                              fontSize: 'calc(var(--font-size-xs) - 1px)',
                              padding: '1px 0',
                              border: 'none',
                              borderBottom: `1px solid ${
                                (() => {
                                  const r = filters.rangeOverrides[c.name];
                                  return r && r[0] === r[1];
                                })()
                                  ? 'var(--color-cyan)'
                                  : 'var(--color-line)'
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
                            className="w-full bg-transparent font-mono text-fg-2 placeholder:text-fg-3 focus:outline-none"
                            style={{
                              fontSize: 'calc(var(--font-size-xs) - 1px)',
                              padding: '1px 0',
                              border: 'none',
                              borderBottom: `1px solid ${
                                filters.textFilters[c.name]?.trim()
                                  ? 'var(--color-cyan)'
                                  : 'var(--color-line)'
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
                            background: 'var(--color-line)',
                            transition: 'opacity var(--t-fast)',
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleResizeStart(c.name, e.clientX, w);
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'var(--color-cyan)';
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'var(--color-line)';
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

          {viewState.isReady && snapshot.count > 0 && drawerState === 'open' && (
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

          {viewState.isReady && snapshot.count === 0 && (
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
                style={{ opacity: 0.3, color: 'var(--color-fg-3)' }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              <Text variant="dim">No records match the current filters</Text>
              <button
                onClick={filters.resetFilters}
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

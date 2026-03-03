/**
 * ParquetPreview — server-side DuckDB over Parquet via POST /api/files/:id/query.
 *
 * UI reuses filter sidebar + virtualizer patterns from the preview component family.
 * Data layer: rows come from fetchWindow() → server query → Map cache.
 */

import { useRef, useMemo, useState, useCallback, useEffect, memo } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useReactTable,
  getCoreRowModel,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table';
import * as Popover from '@radix-ui/react-popover';
import { Text } from '../ui';
import type { StepperStep } from '../ui';
import { useParquetPreview, isNumericType, DROPDOWN_MAX } from '../hooks/useParquetPreview';
import { useDataProfile } from '../hooks/useDataProfile';
import { useDerivedState } from '../hooks/useDerivedState';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../stores/useAppStore';
import type { ColumnInfo, ColumnStats, ColumnCardinality, FilterSpec, FilterOp, SortSpec, PipelineStatus } from '../hooks/useParquetPreview';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROW_H       = 28;
const PX_PER_CHAR   = 7.5;
const CELL_PAD_X    = 6;       // padding: '_ 6px' on header/data cells
const CHEVRON_W     = 8;       // SortChevron svg width
const HEADER_GAP    = 8;       // gap-1 between ColName and chevron
const COL_CHROME    = CELL_PAD_X * 2 + CHEVRON_W + HEADER_GAP;
const MIN_COL_W     = 50;
const MAX_COL_W     = 300;
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
  // Header wraps at `.` — width only needs to fit the longest segment.
  // Child segments get a `› ` prefix (2 chars).
  const segments = name.split('.');
  const headerChars = Math.max(...segments.map((s, i) => s.length + (i > 0 ? 2 : 0)));
  const dataChars = maxCharLen ?? headerChars;
  const chars = Math.max(headerChars, dataChars);
  const px    = Math.round(chars * PX_PER_CHAR) + COL_CHROME;
  return Math.min(MAX_COL_W, Math.max(MIN_COL_W, px));
}

// ── SortChevron ───────────────────────────────────────────────────────────────

function SortChevron({ dir, index }: { dir: 'asc' | 'desc' | false | null; index?: number }) {
  const active = dir === 'asc' || dir === 'desc';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{
        transition: 'transform var(--t-fast) var(--ease-move)',
        transform: dir === 'desc' ? 'rotate(180deg)' : 'none',
        opacity: active ? 1 : 0.3,
        color: active ? 'var(--color-cyan)' : 'inherit',
      }}>
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
        <span key={i}><span style={{ color: 'var(--color-fg-3)' }}>› </span>{part}</span>
      ))}
    </span>
  );
}

// ── Pipeline steps + index for Parquet preview ────────────────────────────────

const PARQUET_STEPS = [
  { key: 'profile',  label: 'Reading schema' },
  { key: 'connect',  label: 'Connecting' },
  { key: 'query',    label: 'Querying server' },
  { key: 'draw',     label: 'Drawing rows' },
  { key: 'ready',    label: 'Ready' },
] as const;


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

const DistributionPlot = memo(function DistributionPlot({
  staticBins, dynamicBins, height, pending,
}: {
  staticBins:   number[];
  dynamicBins?: number[];
  height:       number;
  pending?:     boolean;
}) {
  const n = staticBins.length;
  if (n === 0) return null;

  // Independent density normalization — each layer fills its own peak to full height.
  const staticMax  = useMemo(() => Math.max(...staticBins, 1),  [staticBins]);

  const binW = 100 / n;

  // Bridge network gaps: retain last dynamic bins during queries, clear on reset.
  const activeDynamicBins = useRetainedState(
    dynamicBins && dynamicBins.length > 0 ? dynamicBins : undefined,
    !dynamicBins && !pending,
  );
  const activeBins = activeDynamicBins || staticBins;
  const activeMax = activeBins === staticBins
    ? staticMax
    : Math.max(...activeBins, 1);

  const clipId = useRef(`ghost-mask-${Math.random().toString(36).slice(2, 8)}`).current;

  // Memoize static rects — bin data only changes when server responds, not during drag
  const staticRects = useMemo(() =>
    staticBins.map((v, i) => {
      const barH = (v / staticMax) * height;
      return (
        <rect key={i}
          x={i * binW} y={height - barH}
          width={binW} height={barH}
          fill="var(--color-cyan)"
        />
      );
    }),
    [staticBins, staticMax, height, binW],
  );

  // Memoize dynamic rects — only recompute when bin data or height changes
  const dynamicRects = useMemo(() =>
    activeBins.map((v, i) => {
      const barH = (v / activeMax) * height;
      return (
        <rect key={i}
          x={i * binW}
          width={binW}
          fill="var(--color-cyan)" opacity={0.45}
          style={{
            y: height - barH,
            height: barH,
            transition: 'y 300ms ease-out, height 300ms ease-out',
          }}
        />
      );
    }),
    [activeBins, activeMax, height, binW],
  );

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <clipPath id={clipId}>
          {/* Pure CSS-driven clip — inherits --lo / --hi from parent container */}
          <rect y="0" height={height} style={{
            x: 'calc(var(--lo) * 1%)',
            width: 'max(0px, calc((var(--hi) - var(--lo)) * 1%))',
          } as React.CSSProperties} />
        </clipPath>
      </defs>

      {/* Static layer — absolute reference shape, never clipped */}
      <g opacity={0.12}>{staticRects}</g>

      {/* Dynamic layer — always mounted so CSS can transition from the
           first frame.  Before any filter, overlays the static shape exactly.
           When the first query responds, bars morph smoothly. */}
      <g clipPath={`url(#${clipId})`} style={{
        opacity: pending ? 0.5 : 1,
        transition: 'opacity 200ms',
        animation: pending ? 'distPlotBreath 1.5s ease-in-out infinite' : 'none',
      }}>
        {dynamicRects}
      </g>
    </svg>
  );
},
// Custom comparator: only re-render when bin data or pending changes.
// Clip position is driven by inherited CSS vars — never triggers re-render.
(prev, next) =>
  prev.staticBins === next.staticBins &&
  prev.dynamicBins === next.dynamicBins &&
  prev.height === next.height &&
  prev.pending === next.pending,
);

// ── EditableNumber ────────────────────────────────────────────────────────────

function EditableNumber({ value, min, max, isFloat, color, onCommit, align = 'left' }: {
  value: number; min: number; max: number; isFloat: boolean;
  color: string; onCommit: (v: number) => void; align?: 'left' | 'right';
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
    if (stripped === '' || stripped === '-' || stripped === '.') { setDraft(stripped); return; }
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
        onChange={e => handleChange(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
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
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-fg-3)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}
      title="Click to edit"
    >
      {display}
    </span>
  );
}

// ── Void Detector ─────────────────────────────────────────────────────────────
// If the drag delta swept only through histogram bins with 0 counts,
// the query result is identical — skip the network request.

function hasDataInDelta(
  oldVal: number, newVal: number,
  min: number, max: number,
  histogram: number[],
): boolean {
  const n = histogram.length;
  const range = max - min || 1;
  const toBin = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(((v - min) / range) * (n - 1))));
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
const AMBER_GLOW  = 'oklch(0.750 0.185 60 / 0.28)';
const CYAN_COLOR  = 'var(--color-cyan)';
const CYAN_GLOW   = 'oklch(0.750 0.180 195 / 0.25)';

function RangeSlider({ name, min, max, low, high, onDrag, onCommit, constrainedMin, constrainedMax, pending, staticHistogram, dynamicHistogram }: {
  name: string; min: number; max: number; low: number; high: number;
  onDrag:           (name: string, lo: number, hi: number) => void;
  onCommit:         (name: string) => void;
  constrainedMin?:  number;
  constrainedMax?:  number;
  pending?:         boolean;
  staticHistogram?: number[];
  dynamicHistogram?: number[];
}) {

  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const dragStartRef = useRef<{ lo: number; hi: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);   // outer gauge — CSS var host
  const sliderRef = useRef<HTMLDivElement>(null);  // inner track — pixel measurements
  const panStartRef = useRef<{ x: number; lo: number; hi: number; trackW: number } | null>(null);
  const lowInputRef = useRef<HTMLInputElement>(null);
  const highInputRef = useRef<HTMLInputElement>(null);

  // Stable refs — global listeners and syncTrack always see latest values
  const lowRef = useRef(low);
  const highRef = useRef(high);
  lowRef.current = low;
  highRef.current = high;

  const range   = max - min || 1;
  const full    = low <= min && high >= max;

  // Bridge network gaps: retain constrained bounds during queries, clear on reset.
  const activeConMin = useRetainedState(constrainedMin, full);
  const activeConMax = useRetainedState(constrainedMax, full);
  const isFloat = !Number.isInteger(min) || !Number.isInteger(max);
  const step    = isFloat ? 'any' as const : 1;

  const hasConData = activeConMin !== undefined && activeConMax !== undefined;
  const conLoPct = hasConData ? Math.max(0,   ((activeConMin! - min) / range) * 100) : 0;
  const conHiPct = hasConData ? Math.min(100, ((activeConMax! - min) / range) * 100) : 100;

  // OOB = thumb is visibly past the constrained data boundary.  Epsilon is
  // a visual tolerance (0.1% of range) that absorbs the accumulated float
  // drift across the DuckDB → Arrow IPC → JS pipeline.  If the thumb is
  // within a fraction the eye cannot perceive, honor the scientist's intent.
  const epsilon = range * 0.001;
  const lowOob  = !pending && hasConData && low  < activeConMin! - epsilon;
  const highOob = !pending && hasConData && high > activeConMax! + epsilon;

  // ── Imperative engine — drives all track + thumb visuals at 60fps ──────────
  // React only sees the final values on pointerUp.  Between pointer events
  // every pixel is moved by CSS-variable writes on the container DOM node.

  const syncTrack = useCallback((loVal: number, hiVal: number) => {
    const el = trackRef.current;
    if (!el) return;
    const loPct = ((loVal - min) / range) * 100;
    const hiPct = ((hiVal - min) / range) * 100;
    el.style.setProperty('--lo', String(loPct));
    el.style.setProperty('--hi', String(hiPct));

    // OOB detection — drives amber void + thumb color
    const pendingNow = !!pending;
    const oobLo = !pendingNow && hasConData && loVal < activeConMin! - epsilon;
    const oobHi = !pendingNow && hasConData && hiVal > activeConMax! + epsilon;
    el.style.setProperty('--oob-lo', oobLo ? '0.5' : '0');
    el.style.setProperty('--oob-hi', oobHi ? '0.5' : '0');

    // Thumb colors — direct DOM writes bypass React reconciliation
    const loIn = lowInputRef.current;
    const hiIn = highInputRef.current;
    if (loIn) {
      loIn.style.setProperty('--range-thumb-color', oobLo ? AMBER_COLOR : CYAN_COLOR);
      loIn.style.setProperty('--range-thumb-glow',  oobLo ? AMBER_GLOW  : CYAN_GLOW);
      loIn.style.opacity = String(oobLo ? 0.90 : 1);
    }
    if (hiIn) {
      hiIn.style.setProperty('--range-thumb-color', oobHi ? AMBER_COLOR : CYAN_COLOR);
      hiIn.style.setProperty('--range-thumb-glow',  oobHi ? AMBER_GLOW  : CYAN_GLOW);
      hiIn.style.opacity = String(oobHi ? 0.90 : 1);
    }

    // Force uncontrolled inputs to match (panning, clip-to-reality, reset).
    // Numeric comparison avoids float-string fuzz (e.g. "15" vs "15.000000000001").
    if (loIn && Math.abs(Number(loIn.value) - loVal) > 1e-7) loIn.value = String(loVal);
    if (hiIn && Math.abs(Number(hiIn.value) - hiVal) > 1e-7) hiIn.value = String(hiVal);
  }, [min, range, pending, hasConData, activeConMin, activeConMax, epsilon]);

  // Sync CSS vars + uncontrolled inputs from React props.
  // Only fires when user is NOT interacting (initial mount, reset, commit response).
  useEffect(() => {
    if (!isDragging && !isPanning) syncTrack(low, high);
  }, [low, high, isDragging, isPanning, syncTrack]);

  // Sync constrained bounds as CSS vars (changes on server response only)
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.style.setProperty('--c-lo', String(conLoPct));
    el.style.setProperty('--c-hi', String(conHiPct));
  }, [conLoPct, conHiPct]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleClipToReality = () => {
    if (activeConMin !== undefined && activeConMax !== undefined) {
      onDrag(name, activeConMin, activeConMax);
      onCommit(name);
    }
  };

  const handleDragStart = () => {
    setIsDragging(true);
    dragStartRef.current = { lo: lowRef.current, hi: highRef.current };
  };

  const handleDragEnd = () => {
    // Read the absolute DOM truth — onChange may lag behind the final pixel
    const actualLo = lowInputRef.current ? Number(lowInputRef.current.value) : lowRef.current;
    const actualHi = highInputRef.current ? Number(highInputRef.current.value) : highRef.current;

    // Hard sync — refs, CSS vars, and inputs all agree before anything else
    lowRef.current = actualLo;
    highRef.current = actualHi;
    syncTrack(actualLo, actualHi);

    setIsDragging(false);
    // Void detector: if the drag delta swept only through empty bins, skip the query
    const start = dragStartRef.current;
    if (start && staticHistogram && staticHistogram.length > 0) {
      const loChanged = actualLo !== start.lo;
      const hiChanged = actualHi !== start.hi;
      const loDelta = loChanged && hasDataInDelta(start.lo, actualLo, min, max, staticHistogram);
      const hiDelta = hiChanged && hasDataInDelta(start.hi, actualHi, min, max, staticHistogram);
      if ((loChanged || hiChanged) && !loDelta && !hiDelta) return; // dragged through void
    }
    onDrag(name, actualLo, actualHi);
    onCommit(name);
  };

  // ── Track Panning — grab between thumbs to slide the whole window ──────────

  const handlePanStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = sliderRef.current;
    if (!track) return;
    const trackW = track.getBoundingClientRect().width;
    const lo = lowRef.current;
    const hi = highRef.current;
    panStartRef.current = { x: e.clientX, lo, hi, trackW };
    dragStartRef.current = { lo, hi };
    setIsDragging(true);
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
      if (newLo < min) { newLo = min; newHi = min + span; }
      else if (newHi > max) { newHi = max; newLo = max - span; }
      lowRef.current = newLo;
      highRef.current = newHi;
      syncTrack(newLo, newHi);
      onDrag(name, newLo, newHi);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { capturedTarget.releasePointerCapture(capturedPointerId); } catch {}
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      panStartRef.current = null;
      setIsPanning(false);
      setIsDragging(false);
      const curLo = lowRef.current;
      const curHi = highRef.current;
      const start = dragStartRef.current;
      if (start && staticHistogram && staticHistogram.length > 0) {
        const loChanged = curLo !== start.lo;
        const hiChanged = curHi !== start.hi;
        const loDelta = loChanged && hasDataInDelta(start.lo, curLo, min, max, staticHistogram);
        const hiDelta = hiChanged && hasDataInDelta(start.hi, curHi, min, max, staticHistogram);
        if ((loChanged || hiChanged) && !loDelta && !hiDelta) return;
      }
      onDrag(name, curLo, curHi);
      onCommit(name);
    };

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [name, min, max, range, onDrag, onCommit, staticHistogram, syncTrack]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const PLOT_H = 56;

  // Initial CSS-var seeds — syncTrack overwrites immediately via useEffect,
  // but the inline values prevent a single frame of wrong positioning.
  const lowPct  = ((low  - min) / range) * 100;
  const highPct = ((high - min) / range) * 100;
  const trackVars = {
    '--lo': String(lowPct),
    '--hi': String(highPct),
    '--c-lo': String(conLoPct),
    '--c-hi': String(conHiPct),
    '--oob-lo': lowOob  ? '0.5' : '0',
    '--oob-hi': highOob ? '0.5' : '0',
  } as CSSProperties;

  return (
    <div ref={trackRef} style={{
      background: 'oklch(0.13 0.01 240 / 0.5)',
      borderRadius: 6,
      padding: '6px 8px 4px',
      ...trackVars,
    }}>
      {staticHistogram && staticHistogram.length > 0 && (
        <div className="relative" style={{ height: PLOT_H, marginBottom: 2 }}>
          <DistributionPlot
            staticBins={staticHistogram}
            dynamicBins={hasConData ? dynamicHistogram : undefined}
            height={PLOT_H}
            pending={pending}
          />
        </div>
      )}
      <div ref={sliderRef} className="relative" style={{ height: 20 }}>
        {/* Ghost base — full width reference line */}
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full w-full"
          style={{ height: 2, background: CYAN_COLOR, opacity: 0.10 }} />

        {/* Left amber void — thumb → density boundary (CSS-driven) */}
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full" style={{
          left: 'calc(var(--lo) * 1%)',
          width: 'max(0%, calc((var(--c-lo) - var(--lo)) * 1%))',
          height: 3,
          background: AMBER_COLOR,
          opacity: 'var(--oob-lo)',
          boxShadow: `0 0 6px ${AMBER_GLOW}`,
          transition: 'opacity var(--t-fast)',
        } as CSSProperties} />

        {/* Right amber void — density boundary → thumb (CSS-driven) */}
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full" style={{
          left: 'calc(var(--c-hi) * 1%)',
          width: 'max(0%, calc((var(--hi) - var(--c-hi)) * 1%))',
          height: 3,
          background: AMBER_COLOR,
          opacity: 'var(--oob-hi)',
          boxShadow: `0 0 6px ${AMBER_GLOW}`,
          transition: 'opacity var(--t-fast)',
        } as CSSProperties} />

        {/* Constrained data extent — double-click to clip */}
        {hasConData && (
          <div
            className="absolute top-1/2 -translate-y-1/2 rounded-full"
            title="Double-click to clip handles to this range"
            onDoubleClick={handleClipToReality}
            style={{
              left: 'calc(var(--c-lo) * 1%)',
              width: 'calc(max(0, var(--c-hi) - var(--c-lo)) * 1%)',
              height: 4,
              background: CYAN_COLOR,
              opacity: isDragging ? 0 : pending ? 0.15 : 0.40,
              cursor: 'pointer',
              transition: 'opacity var(--t-fast)',
            } as CSSProperties}
          />
        )}

        {/* Cyan truth track — only where data exists between thumbs */}
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{
            left:  hasConData
              ? 'max(calc(var(--lo) * 1%), calc(var(--c-lo) * 1%))'
              : 'calc(var(--lo) * 1%)',
            right: hasConData
              ? 'max(calc((100 - var(--hi)) * 1%), calc((100 - var(--c-hi)) * 1%))'
              : 'calc((100 - var(--hi)) * 1%)',
            height: 2,
            background: CYAN_COLOR,
            opacity: full ? 0.10 : isDragging ? 1 : hasConData ? 0.40 : 1,
          } as CSSProperties} />

        {/* Pannable window — grab between thumbs to slide the whole range */}
        {!full && (
          <div
            style={{
              position: 'absolute', top: 0,
              left: 'calc(var(--lo) * 1%)',
              width: 'calc(max(0, var(--hi) - var(--lo)) * 1%)',
              height: '100%', zIndex: 2,
              cursor: isPanning ? 'grabbing' : 'grab',
            } as CSSProperties}
            onPointerDown={handlePanStart}
          />
        )}

        <input
          ref={lowInputRef}
          type="range"
          className="range-thumb range-low absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min} max={max} step={step} defaultValue={low}
          style={{ zIndex: 3 } as CSSProperties}
          onPointerDown={handleDragStart}
          onPointerUp={handleDragEnd}
          onChange={e => {
            const v = Math.min(Number(e.target.value), highRef.current);
            lowRef.current = v;
            syncTrack(v, highRef.current);
            onDrag(name, v, highRef.current);
          }}
        />
        <input
          ref={highInputRef}
          type="range"
          className="range-thumb range-high absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min} max={max} step={step} defaultValue={high}
          style={{ zIndex: 4 } as CSSProperties}
          onPointerDown={handleDragStart}
          onPointerUp={handleDragEnd}
          onChange={e => {
            const v = Math.max(Number(e.target.value), lowRef.current);
            highRef.current = v;
            syncTrack(lowRef.current, v);
            onDrag(name, lowRef.current, v);
          }}
        />
      </div>
      <div className="flex justify-between font-mono mt-0.5" style={{ fontSize: 'var(--font-size-xs)' }}>
        <EditableNumber
          value={low} min={min} max={high} isFloat={isFloat}
          color={lowOob ? 'var(--color-amber)' : full ? 'var(--color-fg-3)' : 'var(--color-fg-2)'}
          onCommit={v => { onDrag(name, v, high); onCommit(name); }}
        />
        <EditableNumber
          value={high} min={low} max={max} isFloat={isFloat}
          color={highOob ? 'var(--color-amber)' : full ? 'var(--color-fg-3)' : 'var(--color-fg-2)'}
          onCommit={v => { onDrag(name, low, v); onCommit(name); }}
          align="right"
        />
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
          className="w-full flex items-center justify-between gap-1.5 rounded-sm border border-line px-2 py-1 cursor-pointer bg-transparent transition-colors"
          style={{ fontSize: 'var(--font-size-xs)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-base)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
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
          className="border border-line shadow-lg rounded-md z-popover animate-fade-in"
          style={{ minWidth: 'var(--radix-popover-trigger-width)', maxHeight: 260, overflowY: 'auto', background: 'var(--color-void)' }}
        >
          {count > 0 && (
            <button
              className="block w-full text-left px-2 py-1.5 font-mono cursor-pointer bg-transparent border-none"
              style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)', borderBottom: '1px solid var(--color-line)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-base)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              onClick={() => { onClear(); setOpen(false); }}
            >
              Clear selection
            </button>
          )}
          {values.map(v => (
            <label key={v}
              className="flex items-center gap-2 px-2 py-1 cursor-pointer"
              style={{ fontSize: 'var(--font-size-xs)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-base)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
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
      // Low-cardinality categoricals (≤6 distinct) are chip-only — never in the table.
      // Six chips fit across the 280px grid columns. Numeric columns and
      // high-cardinality categoricals are table-eligible.
      const isLowCard = !isNum && card && card.distinct >= 1 && card.distinct <= 6;
      if (!isLowCard) {
        tableEligible.push(c);
      }
    }
  }
  return { constants, variables, tableEligible };
}

// ── ControlCenter (was FilterSidebar) ─────────────────────────────────────────

const ControlCenter = memo(function ControlCenter({
  columns, columnStats, columnCardinality,
  rangeState, selected, textFilters,
  onRangeDrag, onRangeCommit, onToggleSelect, onClearSelect, onTextChange,
  hasAnyFilter,
  constrainedStats, noResults, pendingConstraints,
  staticHistograms, constrainedHistograms,
  visibleColumns, onToggleVisible,
}: {
  columns:             ColumnInfo[];
  columnStats:         Record<string, ColumnStats>;
  columnCardinality:   Record<string, ColumnCardinality>;
  rangeState:          Record<string, [number, number]>;
  selected:            Record<string, Set<string>>;
  textFilters:         Record<string, string>;
  onRangeDrag:         (name: string, lo: number, hi: number) => void;
  onRangeCommit:       (name: string) => void;
  onToggleSelect:      (name: string, v: string) => void;
  onClearSelect:       (name: string) => void;
  onTextChange:        (name: string, v: string) => void;
  hasAnyFilter:        boolean;
  constrainedStats:    Record<string, ColumnStats>;
  noResults:           boolean;
  pendingConstraints:  boolean;
  staticHistograms:    Record<string, number[]>;
  constrainedHistograms: Record<string, number[]>;
  visibleColumns:      Set<string>;
  onToggleVisible:     (name: string) => void;
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
          <span
            onClick={(e) => { e.stopPropagation(); onToggleVisible(c.name); }}
            className="font-semibold cursor-pointer select-none"
            title={visibleColumns.has(c.name) ? 'Hide in table' : 'Show in table'}
            style={{
              fontSize: 'var(--font-size-xs)',
              color: active ? 'var(--color-cyan)' : visibleColumns.has(c.name) ? 'var(--color-fg-2)' : 'var(--color-fg-3)',
              borderBottom: visibleColumns.has(c.name) ? '1px solid var(--color-cyan)' : '1px dashed var(--color-fg-3)',
              opacity: visibleColumns.has(c.name) ? 1 : 0.5,
              transition: 'color var(--t-fast), opacity var(--t-fast), border-color var(--t-fast)',
            }}
          >
            {c.name}
          </span>
          <span className="font-mono shrink-0 ml-auto" style={{ fontSize: 'calc(var(--font-size-xs) - 1px)', opacity: 0.25 }}>
            {c.type}
          </span>
        </div>

        {isNum ? (
          !stats ? (
            /* Schema says numeric but stats haven't hydrated — skeleton track */
            <div style={{ height: 20, position: 'relative' }}>
              <div className="skeleton rounded-full" style={{ height: 2, width: '100%', position: 'absolute', top: '50%', transform: 'translateY(-50%)' }} />
            </div>
          ) : stats.min === stats.max ? (
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
              onDrag={onRangeDrag}
              onCommit={onRangeCommit}
              staticHistogram={staticHistograms[c.name]}
              dynamicHistogram={hasAnyFilter ? constrainedHistograms[c.name] : undefined}
            />
          )
        ) : hasCard ? (
          card.values.length === 1 ? (
            <span className="font-mono" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)', fontStyle: 'italic' }}>
              {card.values[0]} (constant)
            </span>
          ) : card.values.length <= 6 ? (
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
  };

  return (
    <div style={{ opacity: noResults ? 0.35 : 1, transition: 'opacity var(--t-fast)' }}>
      {/* Low-cardinality chip groups — togglable filters at the top */}
      {lowCard.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 px-4 pt-4 pb-2">
          {lowCard.map(({ col, card, sel }) => (
            <div key={col.name} className="flex items-center gap-1.5">
              <span className="font-semibold shrink-0" style={{
                fontSize: 'var(--font-size-xs)',
                color: sel.size > 0 ? 'var(--color-cyan)' : 'var(--color-fg-3)',
              }}>
                {col.name}
              </span>
              {card.values.map(v => {
                const on = sel.has(v);
                return (
                  <button key={v}
                    onClick={() => onToggleSelect(col.name, v)}
                    className="font-mono cursor-pointer border rounded-sm px-1.5 py-0.5 transition-colors"
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      background:  on ? 'var(--color-cyan)' : 'transparent',
                      color:       on ? 'var(--color-void)' : 'var(--color-fg-2)',
                      borderColor: on ? 'var(--color-cyan)' : 'var(--color-line)',
                      fontWeight:  on ? 600 : 400,
                    }}
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
      <div className="grid gap-4 p-4"
        style={{ gridTemplateColumns: (numerics.length > 0 && texts.length > 0) ? '1fr 1fr' : '1fr' }}>
        {numerics.length > 0 && (
          <div className="grid gap-4 content-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {numerics.map(renderColumnCard)}
          </div>
        )}
        {texts.length > 0 && (
          <div className="grid gap-4 content-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {texts.map(renderColumnCard)}
          </div>
        )}
      </div>
    </div>
  );
});

// ── VirtualRows ───────────────────────────────────────────────────────────────

const VirtualRows = memo(function VirtualRows({
  scrollRef, rowCount, fetchRange, getCell, hasRow, columns, columnStats, colWidths, totalWidth, pipelineStatus, cacheGen: _cacheGen,
}: {
  scrollRef:   RefObject<HTMLDivElement | null>;
  rowCount:    number;
  fetchRange:  (offset: number, limit: number, signal?: AbortSignal) => Promise<void>;
  getCell:     (globalIndex: number, colName: string) => unknown;
  hasRow:      (globalIndex: number) => boolean;
  columns:     ColumnInfo[];
  columnStats: Record<string, ColumnStats>;
  colWidths:   Record<string, number>;
  totalWidth:  number;
  pipelineStatus: PipelineStatus;
  cacheGen:    number; // prop change triggers re-render when Arrow data arrives
}) {
  const virtualizer = useVirtualizer({
    count:            rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize:     () => ROW_H,
    overscan:         20,
    initialRect:      { width: 0, height: 800 },
  });

  // Debounced fetch — waits 150ms after scroll stops before hitting the server.
  // Cancels in-flight requests when the viewport moves again.
  // Eviction handled by the hook's fetchRange (caps at MAX_CACHED_TABLES).
  const items = virtualizer.getVirtualItems();
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const start = items.length > 0 ? items[0].index : -1;
  const end   = items.length > 0 ? items[items.length - 1].index : -1;

  useEffect(() => {
    if (start < 0) return;
    if (pipelineStatus !== 'ready' && pipelineStatus !== 'ready_background_work') return;

    // Collect window starts that need fetching
    const windowStarts: number[] = [];
    const seen = new Set<number>();
    for (let i = start; i <= end; i++) {
      if (!hasRow(i)) {
        const ws = Math.floor(i / WINDOW_SIZE) * WINDOW_SIZE;
        if (!seen.has(ws)) { seen.add(ws); windowStarts.push(ws); }
      }
    }

    if (windowStarts.length === 0) return;

    clearTimeout(timerRef.current);
    abortRef.current?.abort();

    timerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      Promise.all(
        windowStarts.map(ws =>
          fetchRange(ws, WINDOW_SIZE, controller.signal).catch(() => {})
        )
      );
      // No local state update — fetchRange stores the Arrow table in the
      // hook's cache and bumps cacheGen, which propagates as a prop change.
    }, 150);

    return () => {
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, fetchRange, hasRow, pipelineStatus, _cacheGen]);

  return (
    <>
      <div style={{ height: virtualizer.getTotalSize(), minWidth: '100%', width: totalWidth }} />
      <div style={{ position: 'relative', minWidth: '100%', width: totalWidth, marginTop: -virtualizer.getTotalSize() }}>
        {items.map(vRow => {
          const rowLoaded = hasRow(vRow.index);

          return (
            <div key={vRow.key} className="flex"
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H,
                transform: `translateY(${Math.round(vRow.start)}px)`,
                background: 'var(--color-void)',
              }}
            >
              {columns.map(c => {
                const w      = colWidths[c.name] ?? colWFromName(c.name, c.type);
                const isNum  = isNumericType(c.type);
                const stats  = isNum ? columnStats[c.name] : undefined;

                if (!rowLoaded) {
                  const pct = 55 + ((vRow.index * 17 + c.name.length * 11) % 40);
                  return (
                    <div key={c.name} style={{
                      width: w, minWidth: 50, flexShrink: 0,
                      padding: '0 6px',
                      borderBottom: '1px solid var(--color-line)',
                      lineHeight: `${ROW_H}px`,
                    }}>
                      <div className="skeleton rounded" style={{ height: 12, width: `${pct}%`, marginTop: 8,
                        ...(isNum ? { marginLeft: 'auto' } : {}),
                      }} />
                    </div>
                  );
                }

                // Direct Arrow vector access — no materialized Record
                const raw    = getCell(vRow.index, c.name);
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

export default function ParquetPreview({ fileId, onProgress }: {
  fileId: string;
  onProgress?: (config: { steps: StepperStep[]; active: number } | null) => void;
}) {
  const {
    pipeline, columns, totalRows, filteredCount,
    baseProfile,
    getCell, hasRow, fetchRange,
    applyFilters, isQuerying, cacheGen,
  } = useParquetPreview(fileId);

  // Demand-driven: fetch enrichable attributes from the server
  // Fires when columns are available
  const { profile } = useDataProfile(
    columns.length > 0 ? fileId : null,
    ['columnStats', 'cardinality', 'charLengths', 'initialRows', 'histograms'],
    baseProfile,
  );

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

  const staticHistograms: Record<string, number[]> = useMemo(() => {
    const h = profile?.histograms;
    return h ?? {};
  }, [profile?.histograms]);

  const [constrainedHistograms, setConstrainedHistograms] = useState<Record<string, number[]>>({});

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
  // Single source of truth: pipeline.activeStep drives stepper + table body.
  //   0 = Reading schema  → table body: empty void
  //   1 = Starting engine → table body: skeleton grid (columns known)
  //   2 = Opening dataset → table body: skeleton grid
  //   3 = Drawing rows    → table body: skeleton grid
  //   4 = Ready           → table body: real data
  const stage = pipeline.activeStep;

  // ── Broadcast pipeline state to parent via onProgress ──────────────────────
  const isError = pipeline.status === 'error' || pipeline.status === 'failed' || pipeline.status === 'unavailable';
  const displayError = isError ? pipeline.error : undefined;
  const currentActive = stage;
  const currentSteps: StepperStep[] = isError && displayError
    ? PARQUET_STEPS.map((s, i) =>
        i === currentActive ? { ...s, error: displayError } : s
      )
    : [...PARQUET_STEPS];

  useEffect(() => {
    if (pipeline.status === 'unavailable' || pipeline.status === 'failed') {
      onProgress?.(null);
      return;
    }
    onProgress?.({ steps: currentSteps, active: currentActive });
  }, [currentActive, isError, displayError]);

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
        result[c.name] = overrides[c.name] ?? colWFromName(c.name, c.type, charLengths?.[c.name]?.max);
      }
      return result;
    },
    [columns, charLengths],
    {} as Record<string, number>,
  );

  // Range state: base defaults from columnStats, user-modified overrides on top.
  const [rangeState, setRangeOverrides] = useDerivedState(
    (overrides: Record<string, [number, number]>) => {
      const result: Record<string, [number, number]> = {};
      for (const c of columns) {
        if (!isNumericType(c.type)) continue;
        const s = columnStats[c.name];
        if (s) result[c.name] = overrides[c.name] ?? [s.min, s.max];
      }
      return result;
    },
    [columns, columnStats],
    {} as Record<string, [number, number]>,
  );

  const triggerRef = useRef<() => void>(() => {});
  const [selected,           setSelected]           = useState<Record<string, Set<string>>>({});
  const [textFilters,        setTextFilters]        = useState<Record<string, string>>({});
  const [sorting,            setSorting]             = useState<SortingState>([]);
  const [constrainedStats,   setConstrainedStats]   = useState<Record<string, ColumnStats>>({});
  const [pendingConstraints, setPendingConstraints] = useState(false);

  // ── Drawer & column visibility state ────────────────────────────────────────
  const [isTableOpen, setIsTableOpen] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() =>
    new Set(columns.map(c => c.name))
  );

  // Seed visibleColumns when columns first arrive
  const seededRef = useRef(false);
  if (columns.length > 0 && !seededRef.current && visibleColumns.size === 0) {
    seededRef.current = true;
    setVisibleColumns(new Set(columns.map(c => c.name)));
  }

  // activeColumns is defined after partitionColumns — see Derived state section.

  const handleToggleVisible = useCallback((name: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // ── TanStack Table (header sort state only) ────────────────────────────────

  const columnDefs: ColumnDef<unknown>[] = useMemo(() =>
    columns.map(c => ({
      id: c.name,
      accessorKey: c.name,
      meta: { type: c.type },
    })),
    [columns],
  );

  const table = useReactTable({
    data: [],
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    enableMultiSort: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const sortSpecs: SortSpec[] = useMemo(() =>
    sorting.map(s => ({ column: s.id, direction: s.desc ? 'desc' as const : 'asc' as const })),
    [sorting],
  );


  useEffect(() => () => { if (debRef.current) clearTimeout(debRef.current); }, []);

  // ── Build filter specs and apply ────────────────────────────────────────────

  const triggerFilters = useCallback(() => {
    if (pipeline.status !== 'ready') return; // accumulate in state; applied when server is ready

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
    applyFilters(filters, sortSpecs, columnStats).then(result => {
      if (result.constrainedStats) setConstrainedStats(result.constrainedStats);
      else setConstrainedStats({});
      if (result.constrainedHistograms) setConstrainedHistograms(result.constrainedHistograms);
      else setConstrainedHistograms({});
      setPendingConstraints(false);
    }).catch((err) => {
      console.error('Filter query error:', err);
      setPendingConstraints(false);
    });
  }, [pipeline.status, rangeState, selected, textFilters, sortSpecs, columnStats, applyFilters]);

  // Keep ref synced so debounced callbacks always call the latest version
  triggerRef.current = triggerFilters;

  // Catch-up: apply accumulated filters when server becomes ready or sort changes.
  // On the FIRST ready transition, skip the wipe unless the user actually has
  // active filters — otherwise this destroys the pre-flight data already painted.
  const isFirstReadyRef = useRef(true);
  useEffect(() => {
    if (pipeline.status === 'ready') {
      const hasActiveFilters = Object.values(textFilters).some(v => v.trim())
        || Object.keys(selected).some(k => selected[k].size > 0)
        || sorting.length > 0;

      if (isFirstReadyRef.current) {
        isFirstReadyRef.current = false;
        if (!hasActiveFilters) return;
      }
      triggerRef.current();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.status, sorting]);

  // ── Filter handlers ──────────────────────────────────────────────────────────

  // rAF throttle: batch all onChange events within one animation frame into
  // a single setState. Prevents N re-renders per frame when dragging fast.
  const rafRef = useRef<number | null>(null);
  const pendingDrag = useRef<{ name: string; lo: number; hi: number } | null>(null);
  const handleRangeDrag = useCallback((name: string, lo: number, hi: number) => {
    pendingDrag.current = { name, lo, hi };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingDrag.current;
        if (p) setRangeOverrides(prev => ({ ...prev, [p.name]: [p.lo, p.hi] }));
      });
    }
  }, []);

  const handleRangeCommit = useCallback((_name: string) => {
    if (debRef.current) clearTimeout(debRef.current);
    triggerRef.current();
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
    setRangeOverrides({});
    setSelected({});
    setTextFilters({});
    setConstrainedStats({});
    setConstrainedHistograms({});
    setPendingConstraints(false);
    // Clear filters on the hook
    applyFilters([], sortSpecs);
  }, [columns, columnStats, sortSpecs, applyFilters]);

  // ── Column resize ──────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((name: string, startX: number, startW: number) => {
    resizingRef.current = { name, startX, startW };
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      setColWidthOverrides(prev => ({
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

  const hasAnyFilter = Object.entries(rangeState).some(([name, [lo, hi]]) => {
    const s = columnStats[name];
    return s && (lo > s.min || hi < s.max);
  }) || Object.keys(selected).some(k => selected[k].size > 0)
     || Object.values(textFilters).some(v => v.trim());
  const noResults  = hasAnyFilter && filteredCount === 0;

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
  const activeColumns = useMemo(() =>
    tableEligible.filter(c => visibleColumns.has(c.name)),
    [tableEligible, visibleColumns],
  );

  const activeTotalWidth = activeColumns.reduce(
    (s, c) => s + (colWidths[c.name] ?? colWFromName(c.name, c.type, charLengths?.[c.name]?.max)),
    0,
  );

  // Frozen snapshot for the skeleton grid — captured once at stage 1, never changes.
  const skelRef = useRef<{ cols: ColumnInfo[], widths: Record<string, number> } | null>(null);
  if (activeColumns.length > 0 && !skelRef.current) {
    skelRef.current = {
      cols: activeColumns,
      widths: Object.fromEntries(activeColumns.map(c => [c.name, colWidths[c.name] ?? colWFromName(c.name, c.type)])),
    };
  }

  // Memoized skeleton JSX
  const skelData = skelRef.current;
  const SKEL_ROWS = 15;
  const skeletonGrid = useMemo(() => {
    if (!skelData) return null;
    const skelTotalWidth = skelData.cols.reduce((s, c) => s + (skelData.widths[c.name] ?? colWFromName(c.name, c.type)), 0);
    return (
      <div className="flex flex-col" style={{ width: skelTotalWidth }}>
        {Array.from({ length: SKEL_ROWS }, (_, i) => (
          <div key={i} className="flex" style={{ height: ROW_H }}>
            {skelData.cols.map(c => {
              const isNum = isNumericType(c.type);
              return (
                <div key={c.name} style={{
                  width: skelData.widths[c.name] ?? colWFromName(c.name, c.type),
                  minWidth: 50, flexShrink: 0, padding: '0 6px',
                  borderBottom: '1px solid var(--color-line)',
                  lineHeight: `${ROW_H}px`,
                }}>
                  <div className="skeleton rounded"
                    style={{ height: 12, width: `${55 + ((i * 17 + c.name.length * 11) % 40)}%`, marginTop: 8,
                      ...(isNum ? { marginLeft: 'auto' } : {}),
                    }} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }, [skelData]);

  // Memoize the entire skeleton overlay
  const skelVisible = stage >= 1 && stage < 4;
  const skeletonOverlay = useMemo(() => (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'var(--color-void)',
      opacity: skelVisible ? 1 : 0,
      pointerEvents: skelVisible ? 'auto' : 'none',
    }}>
      {skeletonGrid}
    </div>
  ), [skelVisible, skeletonGrid]);

  // ── Loading / error states ─────────────────────────────────────────────────

  if (pipeline.status === 'unavailable' || pipeline.status === 'failed') return null;

  if (isError) return null;

  // ── Render ─────────────────────────────────────────────────────────────────

  const isReady = pipeline.status === 'ready' || pipeline.status === 'ready_background_work';

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{
      background: 'var(--color-void)', minHeight: 600,
    }}>

      {/* ── Row count heading ────────────────────────────────────────────────── */}
      {totalRows > 0 && (
        <div className="shrink-0 flex items-baseline gap-2 px-4 pt-3 pb-1 font-mono" style={{
          fontSize: 'var(--font-size-body)',
        }}>
          <span className="tabular-nums font-semibold" style={{
            color: hasAnyFilter ? 'var(--color-cyan)' : 'var(--color-fg-2)',
            transition: 'color var(--t-fast)',
          }}>
            {filteredCount.toLocaleString()}
          </span>
          <span style={{ color: 'var(--color-fg-3)', transition: 'opacity var(--t-fast)' }}>
            of {totalRows.toLocaleString()} rows
          </span>
          <span style={{
            color: 'var(--color-cyan)',
            opacity: hasAnyFilter ? 1 : 0,
            transition: 'opacity var(--t-fast)',
          }}>
            match
          </span>
          <button onClick={handleClearAll}
            className="cursor-pointer select-none font-mono rounded"
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              padding: '2px 10px',
              color: 'oklch(0.750 0.180 30)',
              border: '1px solid oklch(0.750 0.180 30 / 0.4)',
              background: 'transparent',
              opacity: hasAnyFilter ? 1 : 0,
              pointerEvents: hasAnyFilter ? 'auto' : 'none',
              transition: 'opacity var(--t-fast), background 200ms, border-color 200ms',
              alignSelf: 'center',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'oklch(0.650 0.180 30 / 0.14)';
              e.currentTarget.style.borderColor = 'oklch(0.750 0.180 30 / 0.7)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'oklch(0.750 0.180 30 / 0.4)';
            }}
          >
            Reset
          </button>
        </div>
      )}

      {/* ── Control Center (filter grid + badges) ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {columns.length > 0 ? (

            <>
              {/* Metadata Crown — invariant column badges */}
              {constants.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
                  {constants.map(({ col, value }) => (
                    <span key={col.name}
                      className="font-mono"
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-fg-3)',
                      }}>
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
                selected={selected}
                textFilters={textFilters}
                onRangeDrag={handleRangeDrag}
                onRangeCommit={handleRangeCommit}
                onToggleSelect={handleToggleSelect}
                onClearSelect={handleClearSelect}
                onTextChange={handleTextChange}
                hasAnyFilter={hasAnyFilter}
                constrainedStats={constrainedStats}
                noResults={noResults}
                pendingConstraints={pendingConstraints}
                staticHistograms={staticHistograms}
                constrainedHistograms={constrainedHistograms}
                visibleColumns={visibleColumns}
                onToggleVisible={handleToggleVisible}
              />
            </>

        ) : (
          /* Skeleton control center */
          <div className="grid gap-4 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <div className="skeleton rounded" style={{ height: 10, width: `${50 + (i * 13) % 30}%`, marginBottom: 8 }} />
                <div className="skeleton rounded" style={{ height: 22, width: '100%' }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Show Data — the god bar ──────────────────────────────────────── */}
      <div
        className="shrink-0 cursor-pointer select-none"
        style={{
          background: isTableOpen
            ? 'color-mix(in srgb, var(--color-cyan) 12%, var(--color-cyan-wash))'
            : 'var(--color-cyan-wash)',
          borderTop: '1px solid var(--color-cyan-dim)',
          borderBottom: '1px solid var(--color-cyan-dim)',
          color: 'var(--color-cyan)',
          transition: 'background 200ms',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'color-mix(in srgb, var(--color-cyan) 12%, var(--color-cyan-wash))';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = isTableOpen
            ? 'color-mix(in srgb, var(--color-cyan) 12%, var(--color-cyan-wash))'
            : 'var(--color-cyan-wash)';
        }}
        onClick={() => setIsTableOpen(o => !o)}
      >
        <div className="flex items-center gap-4 px-5" style={{ height: 48 }}>
          <div className="flex items-center gap-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{
                transition: 'transform 300ms ease-out',
                transform: isTableOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span className="font-mono font-bold whitespace-nowrap" style={{
              fontSize: 'var(--font-size-lg)',
              letterSpacing: '0.02em',
            }}>
              {isTableOpen ? 'Hide Data' : 'Show Data'}
            </span>
          </div>
          <div className="flex-1" />
          {totalRows > 0 && (
            <span className="font-mono" style={{ fontSize: 'var(--font-size-body)' }}>
              <span className="tabular-nums font-semibold" style={{
                color: hasAnyFilter ? 'var(--color-cyan)' : 'oklch(0.750 0.180 195 / 0.6)',
              }}>
                {filteredCount.toLocaleString()}
              </span>
              <span style={{ color: 'oklch(0.750 0.180 195 / 0.4)' }}>
                {' '}of {totalRows.toLocaleString()} rows
              </span>
            </span>
          )}
          <div className="flex-1" />

          {/* Column projection — quiet toggles, right side */}
          {tableEligible.length > 0 && (
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            {[
              { label: 'Numeric', subset: tableEligible.filter(c => isNumericType(c.type)) },
              { label: 'Text', subset: tableEligible.filter(c => !isNumericType(c.type)) },
            ].map(({ label, subset }) => {
              if (subset.length === 0) return null;
              const allOn = subset.every(c => visibleColumns.has(c.name));
              return (
                <button key={label}
                  className="cursor-pointer border-none bg-transparent select-none font-mono"
                  style={{
                    fontSize: 'var(--font-size-body)',
                    color: allOn ? 'var(--color-cyan)' : 'var(--color-amber-dim)',
                    borderBottom: allOn ? '1px solid var(--color-cyan)' : '1px solid var(--color-amber-dim)',
                    padding: '0 2px 1px',
                    transition: 'color var(--t-fast), border-color var(--t-fast)',
                  }}
                  onClick={() => {
                    setVisibleColumns(prev => {
                      const next = new Set(prev);
                      if (allOn) {
                        subset.forEach(c => next.delete(c.name));
                      } else {
                        subset.forEach(c => next.add(c.name));
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
      </div>

      {/* ── Table Drawer ───────────────────────────────────────────────────── */}
      <div className="overflow-hidden flex flex-col shrink-0"
        style={{
          height: isTableOpen ? '60vh' : '0px',
          transition: 'height 300ms ease-out',
        }}>
        {/* Table header */}

        <div ref={headerRef} className="shrink-0 overflow-hidden font-mono"
          style={activeColumns.length === 0
            ? { background: 'var(--color-void)', borderBottom: '2px solid var(--color-line)' }
            : undefined}>
          {activeColumns.length > 0 && (() => {
            const headerGroup = table.getHeaderGroups()[0];
            const activeColumnSet = new Set(activeColumns.map(c => c.name));
            const columnMap = new Map(columns.map(c => [c.name, c]));
            return (
              <div className="flex" style={{ minWidth: '100%', width: activeTotalWidth, borderBottom: '2px solid var(--color-line)' }}>
                {headerGroup.headers.map(header => {
                  if (!activeColumnSet.has(header.id)) return null;
                  const c = columnMap.get(header.id)!;
                  const w = colWidths[c.name] ?? colW(c.type);
                  const sorted = header.column.getIsSorted();
                  const sortIdx = header.column.getSortIndex();
                  const multiSort = sorting.length > 1;

                  return (
                    <div key={header.id}
                      className="text-left font-semibold text-fg-2 select-none relative group cursor-pointer"
                      style={{
                        width: w, minWidth: 50, flexShrink: 0, padding: '3px 6px',
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
            );
          })()}
        </div>


        {/* Table body — scrollRef always mounted for stable virtualizer measurement */}
        <div
          ref={scrollRef}
          className="flex-1 min-w-0 overflow-auto"
          style={{ position: 'relative', background: 'var(--color-void)' }}
          onScroll={() => {
            if (headerRef.current && scrollRef.current)
              headerRef.current.scrollLeft = scrollRef.current.scrollLeft;
          }}
        >
          {skeletonOverlay}

          {isReady && filteredCount > 0 && isTableOpen && (
            <VirtualRows
              scrollRef={scrollRef}
              rowCount={filteredCount}
              fetchRange={fetchRange}
              getCell={getCell}
              hasRow={hasRow}
              columns={activeColumns}
              columnStats={columnStats}
              colWidths={colWidths}
              totalWidth={activeTotalWidth}
              pipelineStatus={pipeline.status}
              cacheGen={cacheGen}
            />
          )}

          {isReady && filteredCount === 0 && (
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
  );
}

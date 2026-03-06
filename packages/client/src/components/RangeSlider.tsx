/**
 * RangeSlider — dual-thumb range input with histogram overlay,
 * constrained-axis math, void detection, and panning.
 *
 * Extracted from QueryWorkbench for maintainability.
 */

import type { CSSProperties } from 'react';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { SpringAnimator } from '../lib/SpringAnimator';

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
            opacity: pending ? 0.4 : 1,
            transition: 'opacity 382ms var(--ease-phi)',
          }}
        >
          {dynamicRects}
        </g>

        {/* Empty confirmation — server confirmed zero rows in this range.
            Reads --empty (1 = confirmed empty, 0 = has data or loading). */}
        <line
          x1="0" y1={height} x2="100" y2={height}
          stroke="var(--color-amber)"
          strokeWidth={1}
          clipPath={`url(#${clipId})`}
          style={{
            opacity: 'calc(var(--empty, 0) * 0.5)',
            transition: 'opacity 300ms cubic-bezier(0.382, 0, 0.618, 1)',
          }}
        />
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

// ── The Constrained Axis ──────────────────────────────────────────────────────
// Pure math over numbers. No React, no DOM, no phases.
//
// D = [conMin, conMax] — cross-filtered data extent. Settled fact from other columns.
// R = [lo, hi]         — current slider range. Mutable.
// S = [lo₀, hi₀]      — range at drag start. Sealed at t₀.

interface SealedAxis {
  lo: number;  // S at t₀ — start position
  hi: number;
  hadVoidLo: boolean;  // S \ D ≠ ∅ on the low side at t₀
  hadVoidHi: boolean;  // S \ D ≠ ∅ on the high side at t₀
  /** Projection clip bounds — hadVoid ∧ oob, evaluated live. */
  projBounds(lo: number, hi: number, ax: Axis): { conMin: number | undefined; conMax: number | undefined };
}

// Forward-declare — used in SealedAxis.projBounds signature.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Axis = ReturnType<typeof createAxis>;

function createAxis(min: number, max: number, conMin: number | undefined, conMax: number | undefined) {
  const range = max - min || 1;
  const epsilon = range * 0.001;
  const hasCon = conMin !== undefined && conMax !== undefined;

  return {
    min, max, range, epsilon, conMin, conMax, hasCon,

    /** Continuous OOB — R \ D ≠ ∅? */
    oob(lo: number, hi: number) {
      return {
        lo: hasCon && lo < conMin! - epsilon,
        hi: hasCon && hi > conMax! + epsilon,
      };
    },

    /** Track percentages from values */
    pct(lo: number, hi: number) {
      return {
        lo: ((lo - min) / range) * 100,
        hi: ((hi - min) / range) * 100,
      };
    },

    /** Constrained extent percentages */
    conPct() {
      return {
        lo: hasCon ? Math.max(0, ((conMin! - min) / range) * 100) : 0,
        hi: hasCon ? Math.min(100, ((conMax! - min) / range) * 100) : 100,
      };
    },

    /** Seal at drag start — one-time void-at-start predicate + start position */
    seal(lo: number, hi: number): SealedAxis {
      const hadVoidLo = hasCon && lo < conMin! - epsilon;
      const hadVoidHi = hasCon && hi > conMax! + epsilon;
      return {
        lo, hi, hadVoidLo, hadVoidHi,
        projBounds(curLo: number, curHi: number, ax: Axis) {
          const oob = ax.oob(curLo, curHi);
          return {
            conMin: hadVoidLo && oob.lo ? ax.conMin : undefined,
            conMax: hadVoidHi && oob.hi ? ax.conMax : undefined,
          };
        },
      };
    },
  };
}

// ── Slider State Machine ──────────────────────────────────────────────────────
// Owns phase, seal, and retained D. Every question about what D is at any point
// in the lifecycle has a single answer here.

type SliderPhase = 'idle' | 'dragging' | 'dropped' | 'querying';

interface SliderState {
  phase: SliderPhase;
  seal: SealedAxis | null;
}

type SliderAction =
  | { type: 'DRAG_START'; seal: SealedAxis }
  | { type: 'DRAG_END' }
  | { type: 'VOID_SKIP' }
  | { type: 'PENDING_START' }
  | { type: 'SETTLE' };

const SLIDER_INIT: SliderState = { phase: 'idle', seal: null };

function sliderReducer(state: SliderState, action: SliderAction): SliderState {
  switch (action.type) {
    case 'DRAG_START':
      return { phase: 'dragging', seal: action.seal };
    case 'DRAG_END':
      return { ...state, phase: 'dropped' };
    case 'VOID_SKIP':
      return { phase: 'idle', seal: null };
    case 'PENDING_START':
      return state.phase === 'dropped' ? { ...state, phase: 'querying' } : state;
    case 'SETTLE':
      return state.phase === 'querying' ? { phase: 'idle', seal: null } : state;
    default:
      return state;
  }
}

// Stable color constants — module-level so useCallback deps never churn
const AMBER_COLOR = 'var(--color-amber)';
const AMBER_GLOW = 'oklch(0.750 0.185 60 / 0.28)';
const CYAN_COLOR = 'var(--color-cyan)';
const CYAN_GLOW = 'oklch(0.750 0.180 195 / 0.25)';
const GHOST_COLOR = 'var(--color-fg-3)';
const GHOST_GLOW = 'oklch(0.750 0.000 0 / 0.10)';

// ── RangeSlider Props ─────────────────────────────────────────────────────────

interface RangeSliderProps {
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
  hasAnyFilter?: boolean;
  staticHistogram?: number[];
  dynamicHistogram?: number[];
}

// ── RangeSlider ───────────────────────────────────────────────────────────────

const RangeSlider = React.memo(function RangeSlider({
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
  hasAnyFilter,
  staticHistogram,
  dynamicHistogram,
}: RangeSliderProps) {
  // ── State machine ────────────────────────────────────────────────────────
  //  idle ──DRAG_START──► dragging ──DRAG_END──► dropped ──PENDING_START──► querying ──SETTLE──► idle
  //                                  └──VOID_SKIP──► idle
  const [sm, dispatch] = useReducer(sliderReducer, SLIDER_INIT);
  const { phase, seal: sealed } = sm;
  const [isPanning, setIsPanning] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  // Refs mirror state-machine derivations for closure access in syncTrack
  // and drag handlers. The state machine is the owner; refs are read-only
  // projections. syncTrack reads these directly — zero parameters for state.
  const sealedRef = useRef<SealedAxis | null>(null);
  sealedRef.current = sealed;
  const isActorRef = useRef(false);
  const isSpectatorRef = useRef(false);
  const fullRef = useRef(false);
  const pendingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const animatorRef = useRef<SpringAnimator | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; lo: number; hi: number; trackW: number } | null>(null);
  const lowInputRef = useRef<HTMLInputElement>(null);
  const highInputRef = useRef<HTMLInputElement>(null);
  const lowRef = useRef(low);
  const highRef = useRef(high);
  // Only sync refs from props when idle — during active phases (dragging,
  // dropped, querying) the imperative onChange/pan handlers own these refs.
  // Overwriting mid-drag causes clamping against stale prop values, snapping
  // the thumb backward ("fighting" the user).
  if (phase === 'idle') {
    lowRef.current = low;
    highRef.current = high;
  }

  const isFloat = !Number.isInteger(min) || !Number.isInteger(max);
  const step = isFloat ? ('any' as const) : 1;

  // Debounced drag notification — imperative DOM at 60fps, React only on pause.
  // Resets on every drag event; fires 100ms after the user stops moving.
  // flushDragNotify forces immediate fire on drop.
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDragNotify = useRef<{ lo: number; hi: number } | null>(null);
  const notifyDrag = useCallback((lo: number, hi: number) => {
    pendingDragNotify.current = { lo, hi };
    if (dragTimerRef.current !== null) clearTimeout(dragTimerRef.current);
    dragTimerRef.current = setTimeout(() => {
      dragTimerRef.current = null;
      const p = pendingDragNotify.current;
      if (p) onDrag(name, p.lo, p.hi);
    }, 100);
  }, [onDrag, name]);
  const flushDragNotify = useCallback(() => {
    if (dragTimerRef.current !== null) {
      clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
    const p = pendingDragNotify.current;
    pendingDragNotify.current = null;
    if (p) onDrag(name, p.lo, p.hi);
  }, [onDrag, name]);

  // ── Spring animator lifecycle ────────────────────────────────────────────
  useEffect(() => {
    if (!trackRef.current) return;
    animatorRef.current = new SpringAnimator(trackRef.current);
    return () => animatorRef.current?.dispose();
  }, []);

  // ── Phase derivation ─────────────────────────────────────────────────────
  // effectivePhase snaps querying→idle on the same render pending flips false,
  // so syncTrack runs before paint instead of waiting for SETTLE's re-render.
  const effectivePhase = phase === 'querying' && !pending ? 'idle' : phase;
  const isActor    = effectivePhase === 'dragging' || effectivePhase === 'dropped' || effectivePhase === 'querying';
  const isSpectator = effectivePhase === 'idle' && !!pending;
  const settled    = !isActor && !isSpectator;
  const isDragging = phase === 'dragging';

  // ── The Axis — live D from props (stale-while-revalidate in data layer) ──
  const full = low <= min && high >= max;

  // Mirror state-machine derivations into refs — syncTrack reads these directly
  isActorRef.current = isActor;
  isSpectatorRef.current = isSpectator;
  fullRef.current = full;
  pendingRef.current = !!pending;
  const activeConMin = (full && !hasAnyFilter) ? undefined : constrainedMin;
  const activeConMax = (full && !hasAnyFilter) ? undefined : constrainedMax;
  const axis = useMemo(
    () => createAxis(min, max, activeConMin, activeConMax),
    [min, max, activeConMin, activeConMax],
  );
  // Ref mirror so drag closures always read the latest axis
  const axisRef = useRef(axis);
  axisRef.current = axis;
  const renderOob = axis.oob(low, high);
  const projectedHistogram = useMemo(() => {
    if (!staticHistogram || full) return undefined;
    const pb = sealed?.projBounds(low, high, axis);
    return projectHistogram(staticHistogram, low, high, min, max, pb?.conMin, pb?.conMax);
  }, [staticHistogram, low, high, min, max, full, sealed, axis]);

  // ── Visual layer — three dumb writers ─────────────────────────────────────

  /** syncTrack — owns --lo, --hi, --oob-lo, --oob-hi, thumb colors.
   *  Three visual states per side:
   *    amber  = hadVoid ∧ oob  (confirmed void — started OOB, still OOB)
   *    ghost  = ¬hadVoid ∧ oob (fog of war — crossed ∂D mid-drag)
   *    normal = ¬oob           (in-band)
   */
  const syncTrack = useCallback(
    (loVal: number, hiVal: number, ax: Axis) => {
      const el = trackRef.current;
      if (!el) return;
      // Read state from refs — zero parameters for state-derived values
      const actor = isActorRef.current;
      const seal = sealedRef.current;
      const isFull = fullRef.current;
      const pend = pendingRef.current;

      const p = ax.pct(loVal, hiVal);
      el.style.setProperty('--lo', String(p.lo));
      el.style.setProperty('--hi', String(p.hi));
      const c = ax.conPct();
      el.style.setProperty('--c-lo', String(c.lo));
      el.style.setProperty('--c-hi', String(c.hi));
      el.style.setProperty('--has-con', ax.hasCon ? '1' : '0');
      el.style.setProperty('--settled', actor ? '0' : '1');
      // Truth track opacity — colocated with geometry vars
      const truthOpacity = isFull ? 0.1
        : actor && seal != null && (seal.hadVoidLo || seal.hadVoidHi) ? 0.4
        : actor ? 1
        : !actor && pend ? 0.15
        : ax.hasCon ? 0.4
        : 1;
      el.style.setProperty('--truth-opacity', String(truthOpacity));
      const loIn = lowInputRef.current;
      const hiIn = highInputRef.current;
      if (loIn && Math.abs(Number(loIn.value) - loVal) > 1e-7) loIn.value = String(loVal);
      if (hiIn && Math.abs(Number(hiIn.value) - hiVal) > 1e-7) hiIn.value = String(hiVal);
      const oob = ax.oob(loVal, hiVal);
      const ghostLo = oob.lo && actor && seal != null && !seal.hadVoidLo;
      const ghostHi = oob.hi && actor && seal != null && !seal.hadVoidHi;
      el.style.setProperty('--oob-lo', oob.lo && !ghostLo ? '0.5' : '0');
      el.style.setProperty('--oob-hi', oob.hi && !ghostHi ? '0.5' : '0');
      if (loIn) {
        const [c, g] = ghostLo ? [GHOST_COLOR, GHOST_GLOW] : oob.lo ? [AMBER_COLOR, AMBER_GLOW] : [CYAN_COLOR, CYAN_GLOW];
        loIn.style.setProperty('--range-thumb-color', c);
        loIn.style.setProperty('--range-thumb-glow', g);
        loIn.style.opacity = String(oob.lo ? (ghostLo ? 0.5 : 0.9) : 1);
      }
      if (hiIn) {
        const [c, g] = ghostHi ? [GHOST_COLOR, GHOST_GLOW] : oob.hi ? [AMBER_COLOR, AMBER_GLOW] : [CYAN_COLOR, CYAN_GLOW];
        hiIn.style.setProperty('--range-thumb-color', c);
        hiIn.style.setProperty('--range-thumb-glow', g);
        hiIn.style.opacity = String(oob.hi ? (ghostHi ? 0.5 : 0.9) : 1);
      }
    },
    [],
  );

  /** syncHistogram — owns --dyn-N via spring animator. */
  const syncHistogram = useCallback(
    (bins: number[]) => {
      animatorRef.current?.setTargets(bins);
    },
    [],
  );

  // ── Settle — close the querying→idle loop when the server responds ────────
  useLayoutEffect(() => {
    if (!pending && phase === 'querying') dispatch({ type: 'SETTLE' });
  }, [pending, phase]);

  // ── Layout effect — phase bookkeeping + non-actor sync ────────────────────
  useLayoutEffect(() => {
    if (pending && phase === 'dropped') dispatch({ type: 'PENDING_START' });

    if (isActor) return;

    syncTrack(low, high, axis);

    if (!isSpectator) {
      const bins = dynamicHistogram ?? projectedHistogram ?? staticHistogram;
      if (bins) syncHistogram(bins);
    }
  }, [low, high, isActor, isSpectator, pending, phase, axis, sealed,
      syncTrack, syncHistogram,
      projectedHistogram, dynamicHistogram, staticHistogram]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleClipToReality = () => {
    if (axis.conMin !== undefined && axis.conMax !== undefined) {
      onDrag(name, axis.conMin, axis.conMax);
      onCommit(name, axis.conMin, axis.conMax);
    }
  };

  const handleDragStart = () => {
    const lo = lowRef.current;
    const hi = highRef.current;
    const newSeal = axisRef.current.seal(lo, hi);
    sealedRef.current = newSeal;
    dispatch({ type: 'DRAG_START', seal: newSeal });
  };

  const handleDragEnd = () => {
    flushDragNotify();
    const actualLo = lowInputRef.current ? Number(lowInputRef.current.value) : lowRef.current;
    const actualHi = highInputRef.current ? Number(highInputRef.current.value) : highRef.current;
    lowRef.current = actualLo;
    highRef.current = actualHi;
    syncTrack(actualLo, actualHi, axisRef.current);

    // Void detector: read seal (survives through querying, SETTLE clears it)
    const start = sealedRef.current;
    if (start && staticHistogram && staticHistogram.length > 0) {
      const loChanged = actualLo !== start.lo;
      const hiChanged = actualHi !== start.hi;
      const loDelta = loChanged && hasDataInDelta(start.lo, actualLo, min, max, staticHistogram);
      const hiDelta = hiChanged && hasDataInDelta(start.hi, actualHi, min, max, staticHistogram);
      if ((loChanged || hiChanged) && !loDelta && !hiDelta) {
        dispatch({ type: 'VOID_SKIP' });
        onDrag(name, actualLo, actualHi);
        onCommit(name, actualLo, actualHi);
        return;
      }
    }
    dispatch({ type: 'DRAG_END' });
    onDrag(name, actualLo, actualHi);
    onCommit(name, actualLo, actualHi);
  };

  // ── Track Panning ─────────────────────────────────────────────────────────

  const handlePanStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const track = sliderRef.current;
      if (!track) return;
      const trackW = track.getBoundingClientRect().width;
      const lo = lowRef.current;
      const hi = highRef.current;
      const ax = axisRef.current;
      panStartRef.current = { x: e.clientX, lo, hi, trackW };
      const newSeal = ax.seal(lo, hi);
      sealedRef.current = newSeal;
      dispatch({ type: 'DRAG_START', seal: newSeal });
      setIsPanning(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const capturedTarget = e.target as HTMLElement;
      const capturedPointerId = e.pointerId;

      const onMove = (ev: PointerEvent) => {
        const s = panStartRef.current;
        if (!s) return;
        const deltaPx = ev.clientX - s.x;
        const curAx = axisRef.current;
        const deltaVal = (deltaPx / s.trackW) * curAx.range;
        const span = s.hi - s.lo;
        let newLo = s.lo + deltaVal;
        let newHi = s.hi + deltaVal;
        if (newLo < curAx.min) { newLo = curAx.min; newHi = curAx.min + span; }
        else if (newHi > curAx.max) { newHi = curAx.max; newLo = curAx.max - span; }
        lowRef.current = newLo;
        highRef.current = newHi;
        syncTrack(newLo, newHi, curAx);

        const seal = sealedRef.current;
        const pb = seal?.projBounds(newLo, newHi, curAx);
        if (staticHistogram) syncHistogram(projectHistogram(staticHistogram, newLo, newHi, curAx.min, curAx.max, pb?.conMin, pb?.conMax));
        notifyDrag(newLo, newHi);
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try { capturedTarget.releasePointerCapture(capturedPointerId); } catch {}
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        panStartRef.current = null;
        setIsPanning(false);
        flushDragNotify();
        const curLo = lowRef.current;
        const curHi = highRef.current;
        const start = sealedRef.current;
        if (start && staticHistogram && staticHistogram.length > 0) {
          const loChanged = curLo !== start.lo;
          const hiChanged = curHi !== start.hi;
          const loDelta = loChanged && hasDataInDelta(start.lo, curLo, min, max, staticHistogram);
          const hiDelta = hiChanged && hasDataInDelta(start.hi, curHi, min, max, staticHistogram);
          if ((loChanged || hiChanged) && !loDelta && !hiDelta) {
            dispatch({ type: 'VOID_SKIP' });
            onDrag(name, curLo, curHi);
            onCommit(name, curLo, curHi);
            return;
          }
        }
        dispatch({ type: 'DRAG_END' });
        onDrag(name, curLo, curHi);
        onCommit(name, curLo, curHi);
      };

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [name, min, max, onDrag, onCommit, staticHistogram, syncTrack, syncHistogram],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const PLOT_H = 56;
  const oob = axis.oob(low, high);

  return (
    <div
      ref={trackRef}
      data-column={name}
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
            } as CSSProperties
          }
        />

        {/* Constrained data extent — double-click to clip */}
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
              opacity: 'calc(var(--has-con, 0) * var(--settled, 0) * 0.4)',
              cursor: 'pointer',
              transition: 'opacity var(--t-fast)',
            } as CSSProperties
          }
        />


        {/* Cyan truth track — R ∩ D, where data exists between thumbs */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={
            {
              left: 'max(calc(var(--lo) * 1%), calc(var(--c-lo) * 1%))',
              right: 'max(calc((100 - var(--hi)) * 1%), calc((100 - var(--c-hi)) * 1%))',
              height: 2,
              background: CYAN_COLOR,
              opacity: 'var(--truth-opacity)',
            } as CSSProperties
          }
        />

        {/* Pannable window */}
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
            const ax = axisRef.current;
            syncTrack(v, highRef.current, ax);

            const seal = sealedRef.current;
            const pb = seal?.projBounds(v, highRef.current, ax);
            if (staticHistogram) syncHistogram(projectHistogram(staticHistogram, v, highRef.current, ax.min, ax.max, pb?.conMin, pb?.conMax));
            notifyDrag(v, highRef.current);
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
            const ax = axisRef.current;
            syncTrack(lowRef.current, v, ax);

            const seal = sealedRef.current;
            const pb = seal?.projBounds(lowRef.current, v, ax);
            if (staticHistogram) syncHistogram(projectHistogram(staticHistogram, lowRef.current, v, ax.min, ax.max, pb?.conMin, pb?.conMax));
            notifyDrag(lowRef.current, v);
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
          color={
            renderOob.lo
              ? sealed && !sealed.hadVoidLo
                ? 'var(--color-fg-3)'   // ghost — fog of war
                : 'var(--color-amber)'  // confirmed void or settled OOB
              : full ? 'var(--color-fg-3)' : 'var(--color-fg-2)'
          }
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
          color={
            renderOob.hi
              ? sealed && !sealed.hadVoidHi
                ? 'var(--color-fg-3)'   // ghost — fog of war
                : 'var(--color-amber)'  // confirmed void or settled OOB
              : full ? 'var(--color-fg-3)' : 'var(--color-fg-2)'
          }
          onCommit={(v) => {
            onDrag(name, low, v);
            onCommit(name, low, v);
          }}
          align="right"
        />
      </div>
    </div>
  );
});

export default RangeSlider;

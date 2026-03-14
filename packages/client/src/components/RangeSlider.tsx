/**
 * RangeSlider — dual-thumb range input with histogram overlay,
 * constrained-axis math, void detection, and panning.
 *
 * Canvas for the data, DOM for the interface.
 * Canvas is for things you cannot touch.
 * Histogram bars are painted to a single <canvas> element via SpringAnimator.
 * The slider track, thumbs, void indicators, and labels remain DOM — things you touch.
 */

import type { CSSProperties } from 'react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ticker } from '../lib/AnimationTicker';
import { histogramProjection } from '../lib/HistogramProjection';
import { SpringAnimator } from '../lib/SpringAnimator';

// ── Canvas color constants — oklch strings work directly as fillStyle ────────
const CANVAS_CYAN = 'oklch(0.75 0.18 195)';
const CANVAS_AMBER = 'oklch(0.75 0.185 60)';
const BREATH_GRACE_MS = 300;

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
  const hasCon = conMin !== undefined && conMax !== undefined;

  return {
    min, max, range, conMin, conMax, hasCon,

    /** Continuous OOB — R \ D ≠ ∅? */
    oob(lo: number, hi: number) {
      return {
        lo: hasCon && lo < conMin!,
        hi: hasCon && hi > conMax!,
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
      const hadVoidLo = hasCon && lo < conMin!;
      const hadVoidHi = hasCon && hi > conMax!;
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
      return state.phase === 'querying' || state.phase === 'dropped'
        ? { phase: 'idle', seal: null } : state;
    default:
      return state;
  }
}

// Stable color constants — module-level so useCallback deps never churn
const AMBER_COLOR = 'var(--color-amber)';
const AMBER_GLOW = 'oklch(0.750 0.185 60 / 0.28)';
const CYAN_COLOR = 'var(--color-cyan)';
const CYAN_GLOW = 'oklch(0.750 0.180 195 / 0.25)';

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
  onSortByCorrelation?: () => void;
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
  onSortByCorrelation,
}: RangeSliderProps) {
  // ── State machine ────────────────────────────────────────────────────────
  //  idle ──DRAG_START──► dragging ──DRAG_END──► dropped ──PENDING_START──► querying ──SETTLE──► idle
  //                                  └──VOID_SKIP──► idle
  const [sm, dispatch] = useReducer(sliderReducer, SLIDER_INIT);
  const { phase, seal: sealed } = sm;
  const [isPanning, setIsPanning] = useState(false);
  const [logY, setLogY] = useState(false);
  const logYRef = useRef(false);
  logYRef.current = logY;

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
  const breathingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const animatorRef = useRef<SpringAnimator | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; lo: number; hi: number; trackW: number } | null>(null);
  const lowInputRef = useRef<HTMLInputElement>(null);
  const highInputRef = useRef<HTMLInputElement>(null);
  const lowRef = useRef(low);
  const highRef = useRef(high);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticBinsRef = useRef<number[]>([]);
  const clipBoundsRef = useRef({ lo: 0, hi: 100 });
  const springPositionsRef = useRef<Float64Array>(new Float64Array(64));
  const emptyRef = useRef(0);  // dormant — --empty is never set by JS today
  const coalescedFrameRef = useRef<number | null>(null);
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
  const snap = isFloat ? (v: number) => v : (v: number) => Math.round(v);

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

  // ── Canvas paint — imperative draw function ────────────────────────────
  const paintCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;

    // Resize backing store if needed
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const bins = staticBinsRef.current;
    const n = bins.length;
    if (n === 0) return;

    let staticMax = 0;
    for (let i = 0; i < n; i++) if (bins[i] > staticMax) staticMax = bins[i];
    if (staticMax === 0) staticMax = 1;
    const binW = w / n;
    const positions = springPositionsRef.current;
    const { lo, hi } = clipBoundsRef.current;
    const pend = pendingRef.current;

    // Static layer — full reference shape, unclipped
    // When log is active, transform counts to match the spring targets
    const useLog = logYRef.current;
    const logMax = useLog ? Math.log10(staticMax + 1) : 1;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = CANVAS_CYAN;
    for (let i = 0; i < n; i++) {
      const barH = useLog
        ? (Math.log10(bins[i] + 1) / logMax) * h
        : (bins[i] / staticMax) * h;
      ctx.fillRect(i * binW, h - barH, binW, barH);
    }

    // Dynamic layer — clipped to [lo, hi], spring-driven heights
    const clipX = (lo / 100) * w;
    const clipW = Math.max(0, ((hi - lo) / 100) * w);
    ctx.save();
    ctx.beginPath();
    ctx.rect(clipX, 0, clipW, h);
    ctx.clip();

    let dynAlpha = 0.45;
    const breathing = breathingRef.current;
    if (breathing) {
      // Replicate distPlotBreath: sinusoidal between 0.25 and 0.5
      const t = (performance.now() % 1500) / 1500;
      dynAlpha = 0.25 + 0.125 * (1 - Math.cos(2 * Math.PI * t));
    }

    ctx.globalAlpha = dynAlpha;
    ctx.fillStyle = CANVAS_CYAN;
    for (let i = 0; i < n; i++) {
      const barH = positions[i] * h;
      ctx.fillRect(i * binW, h - barH, binW, barH);
    }

    // Empty confirmation — amber line at bottom (dormant — emptyRef is always 0)
    const emptyVal = emptyRef.current;
    if (emptyVal > 0) {
      ctx.globalAlpha = emptyVal * 0.5;
      ctx.strokeStyle = CANVAS_AMBER;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h - 0.5);
      ctx.lineTo(clipW > 0 ? clipX + clipW : w, h - 0.5);
      ctx.stroke();
    }

    ctx.restore();
  }, []);

  // ── Imperative lifecycle — spring animator + debounce timer cleanup ─────
  // useLayoutEffect so the animator exists before the target-setting layout
  // effect (below) runs, and subscribes to the AnimationTicker in the same
  // execution phase as RiverGauge's SingleSpring — guaranteeing frame-lock.
  useLayoutEffect(() => {
    animatorRef.current = new SpringAnimator((positions) => {
      springPositionsRef.current = positions;
      paintCanvas();
    });
    return () => {
      animatorRef.current?.dispose();
      if (dragTimerRef.current !== null) clearTimeout(dragTimerRef.current);
      if (coalescedFrameRef.current !== null) cancelAnimationFrame(coalescedFrameRef.current);
    };
  }, [paintCanvas]);

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
  const projectedHistogram = useMemo(() => {
    if (!staticHistogram || full) return undefined;
    const pb = sealed?.projBounds(low, high, axis);
    return histogramProjection.project(staticHistogram, { lo: low, hi: high, min, max, conMin: pb?.conMin, conMax: pb?.conMax });
  }, [staticHistogram, low, high, min, max, full, sealed, axis]);

  // ── Sync static bins ref for canvas paint ─────────────────────────────────
  useLayoutEffect(() => {
    if (staticHistogram) staticBinsRef.current = staticHistogram;
  }, [staticHistogram]);

  // ── Log toggle — re-target springs so bars bounce to new positions ────────
  useLayoutEffect(() => {
    const bins = dynamicHistogram ?? projectedHistogram ?? staticHistogram;
    if (bins) syncHistogram(bins);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logY]);

  // ── Visual layer — three dumb writers ─────────────────────────────────────

  /** syncTrack — owns --lo, --hi, thumb values, input sync. */
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
      clipBoundsRef.current = { lo: p.lo, hi: p.hi };
      paintCanvas();
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
      el.style.setProperty('--oob-lo', oob.lo ? '0.5' : '0');
      el.style.setProperty('--oob-hi', oob.hi ? '0.5' : '0');
    },
    [],
  );

  /** syncHistogram — drives spring-animated bars via canvas paint callback.
   *  When logY is active, targets are log-transformed so the springs animate
   *  to the log positions and bounce on toggle. */
  const syncHistogram = useCallback(
    (bins: number[]) => {
      if (logYRef.current) {
        let mx = 0;
        for (let i = 0; i < bins.length; i++) if (bins[i] > mx) mx = bins[i];
        if (mx === 0) mx = 1;
        const logMax = Math.log10(mx + 1);
        const logBins = bins.map((v) => (Math.log10(v + 1) / logMax) * mx);
        animatorRef.current?.setTargets(logBins);
      } else {
        animatorRef.current?.setTargets(bins);
      }
    },
    [],
  );

  // ── Input coalescing — at most one drag update per frame ────────────────
  // Drag handlers write to refs and schedule; the frame callback reads refs
  // and runs syncTrack + syncHistogram + notifyDrag exactly once.
  const scheduleDragFrame = useCallback(() => {
    if (coalescedFrameRef.current !== null) return; // already scheduled
    coalescedFrameRef.current = requestAnimationFrame(() => {
      coalescedFrameRef.current = null;
      const lo = lowRef.current;
      const hi = highRef.current;
      const ax = axisRef.current;
      syncTrack(lo, hi, ax);
      const seal = sealedRef.current;
      const pb = seal?.projBounds(lo, hi, ax);
      const bins = staticBinsRef.current;
      if (bins.length > 0) {
        syncHistogram(histogramProjection.project(bins, { lo, hi, min: ax.min, max: ax.max, conMin: pb?.conMin, conMax: pb?.conMax }));
      }
      notifyDrag(lo, hi);
    });
  }, [syncTrack, syncHistogram, notifyDrag]);

  // ── Canvas ResizeObserver ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => paintCanvas());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [paintCanvas]);

  // ── Breathing tick — 300ms grace period before breathing starts ─────────────
  // Fast queries (<300ms): user sees only the spring correction, no breathing.
  // Slow queries (>300ms): breathing kicks in as "still working" indicator.
  useEffect(() => {
    if (!pending) {
      breathingRef.current = false;
      paintCanvas();
      return;
    }
    const breathTick = () => { paintCanvas(); return true; };
    const timer = setTimeout(() => {
      breathingRef.current = true;
      ticker.subscribe(breathTick);
    }, BREATH_GRACE_MS);
    return () => {
      clearTimeout(timer);
      breathingRef.current = false;
      ticker.unsubscribe(breathTick); // safe no-op if never subscribed (Set.delete)
    };
  }, [pending, paintCanvas]);

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
    // Cancel pending coalesced frame — we process final values here
    if (coalescedFrameRef.current !== null) {
      cancelAnimationFrame(coalescedFrameRef.current);
      coalescedFrameRef.current = null;
    }
    flushDragNotify();
    const actualLo = snap(lowInputRef.current ? Number(lowInputRef.current.value) : lowRef.current);
    const actualHi = snap(highInputRef.current ? Number(highInputRef.current.value) : highRef.current);
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
        // Coalesce — take the last pointer position from the OS batch
        const coalesced = ev.getCoalescedEvents?.();
        const last = coalesced && coalesced.length > 0 ? coalesced[coalesced.length - 1] : ev;
        const deltaPx = last.clientX - s.x;
        const curAx = axisRef.current;
        const deltaVal = (deltaPx / s.trackW) * curAx.range;
        const span = s.hi - s.lo;
        let newLo = snap(s.lo + deltaVal);
        let newHi = snap(s.hi + deltaVal);
        if (newLo < curAx.min) { newLo = curAx.min; newHi = curAx.min + span; }
        else if (newHi > curAx.max) { newHi = curAx.max; newLo = curAx.max - span; }
        lowRef.current = newLo;
        highRef.current = newHi;
        scheduleDragFrame();
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        // Cancel pending coalesced frame — onUp processes final values
        if (coalescedFrameRef.current !== null) {
          cancelAnimationFrame(coalescedFrameRef.current);
          coalescedFrameRef.current = null;
        }
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
    [name, min, max, onDrag, onCommit, staticHistogram, scheduleDragFrame, flushDragNotify],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const PLOT_H = 56;

  return (
    <ContextMenu.Root>
    <ContextMenu.Trigger asChild>
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
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
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
            lowRef.current = Math.min(Number(e.target.value), highRef.current);
            scheduleDragFrame();
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
            highRef.current = Math.max(Number(e.target.value), lowRef.current);
            scheduleDragFrame();
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
          color={full ? 'var(--color-fg-3)' : 'var(--color-fg-2)'}
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
          color={full ? 'var(--color-fg-3)' : 'var(--color-fg-2)'}
          onCommit={(v) => {
            onDrag(name, low, v);
            onCommit(name, low, v);
          }}
          align="right"
        />
      </div>
    </div>
    </ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Content
        className="min-w-[140px] rounded-md border py-1"
        style={{
          background: 'oklch(0.15 0.01 240)',
          borderColor: 'oklch(0.3 0.01 240)',
          boxShadow: '0 8px 24px oklch(0 0 0 / 0.5)',
          zIndex: 50,
        }}
      >
        <ContextMenu.CheckboxItem
          className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer outline-none"
          style={{ color: 'var(--color-fg-2)' }}
          checked={logY}
          onCheckedChange={(v) => { setLogY(!!v); requestAnimationFrame(() => paintCanvas()); }}
          onSelect={(e) => e.preventDefault()}
        >
          <span className="inline-flex w-3 justify-center" style={{ color: 'var(--color-cyan)' }}>
            {logY ? '\u2713' : ''}
          </span>
          Log scale (Y)
        </ContextMenu.CheckboxItem>
        {onSortByCorrelation && (
          <ContextMenu.Item
            className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer outline-none"
            style={{ color: 'var(--color-fg-2)' }}
            onSelect={() => onSortByCorrelation()}
          >
            <span className="inline-flex w-3 justify-center" style={{ color: 'var(--color-cyan)' }}>⇅</span>
            Sort by correlation
          </ContextMenu.Item>
        )}
      </ContextMenu.Content>
    </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

export default RangeSlider;

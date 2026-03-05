import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { SingleSpring } from '../lib/SpringAnimator';

/**
 * RiverGauge — universal capacity/progress bar.
 *
 * Two physics modes:
 *   **tide**  — bidirectional. Filters raise and lower the bar freely.
 *   **waterfall** — monotonic. Persistent ratchet via refs. The bar only
 *     surges forward. At 100% it glows, settles, then dissolves.
 *
 * Motion is driven by SingleSpring (underdamped spring physics via rAF),
 * same constants as the histogram SpringAnimator. The ratchet is the guard.
 */
export default function RiverGauge({
  current,
  total,
  accent,
  compact,
  variant = 'tide',
  resetKey,
  flowState = 'normal',
  statusLabel,
}: {
  current: number;
  total: number;
  /** Highlight the readout in cyan. */
  accent?: boolean;
  compact?: boolean;
  /** 'tide' = bidirectional, 'waterfall' = monotonic with terminal dissolve. */
  variant?: 'tide' | 'waterfall';
  /** When this changes, the waterfall resets its high-water mark. */
  resetKey?: number | string;
  /** Visual flow state: 'normal' renders idle, 'pending' breathes, 'stalled' goes amber. */
  flowState?: 'normal' | 'pending' | 'stalled';
  /** Override the "of X" label (e.g. "query failed"). */
  statusLabel?: string;
}) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  const h = compact ? 10 : 16;

  // ── Persistent Ratchet (refs survive re-renders and parent decay) ──
  const maxPctRef = useRef(0);
  const prevResetKeyRef = useRef(resetKey);

  // ── Settle state: the dance must finish before dissolve ──
  const [settled, setSettled] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset detection — clear ratchet and settle state
  if (resetKey !== prevResetKeyRef.current) {
    prevResetKeyRef.current = resetKey;
    maxPctRef.current = 0;
    setSettled(false);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  }

  // The ratchet drives displayPct — math enforces the waterfall, not the toggle
  let displayPct: number;
  if (variant === 'waterfall') {
    if (pct > maxPctRef.current) maxPctRef.current = pct;
    displayPct = maxPctRef.current;
  } else {
    displayPct = pct;
  }

  const isTerminal = variant === 'waterfall' && displayPct >= 100;

  // ── Spring lifecycle ──
  const fillRef = useRef<HTMLDivElement>(null);
  const springRef = useRef<SingleSpring | null>(null);

  useLayoutEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    springRef.current = new SingleSpring((pct) => {
      el.style.setProperty('--gauge-pct', String(pct));
    });
    return () => { springRef.current?.dispose(); springRef.current = null; };
  }, []);

  // Drive spring from displayPct
  const springResetRef = useRef(resetKey);

  useLayoutEffect(() => {
    const spring = springRef.current;
    if (!spring) return;
    if (resetKey !== springResetRef.current) {
      springResetRef.current = resetKey;
      spring.snap(0);
    }
    spring.setTarget(displayPct);
  }, [displayPct, resetKey]);

  // Settle timer: wait for the surge to land before dissolving
  // 600ms clip bounce + 200ms breathing room = 800ms settle
  useEffect(() => {
    if (isTerminal && !settled) {
      settleTimerRef.current = setTimeout(() => setSettled(true), 800);
      return () => {
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      };
    }
  }, [isTerminal, settled]);

  // Clean up on unmount
  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  }, []);

  return (
    <div
      className={`flex flex-col gap-1 river-gauge${settled ? ' dissolved' : ''}`}
      style={{ minWidth: compact ? 140 : 220 }}
    >
      {/* Readout */}
      <div className="flex items-baseline gap-2 font-mono tabular-nums">
        <span className={`font-bold river-readout${compact ? ' compact' : ''}${current === 0 ? ' empty' : accent ? ' accent' : ''}`}>
          {current.toLocaleString()}
        </span>
        <span className={`river-total${flowState === 'stalled' ? ' stalled' : ''}`}>
          {statusLabel ?? `of ${total.toLocaleString()}`}
        </span>
      </div>

      {/* The Conduit — fill is always 100% wide, clip-path reveals it */}
      <div className="w-full river-groove" style={{ height: h }}>
        <div
          ref={fillRef}
          className={`h-full river-fill${isTerminal ? ' river-impact' : ''}${flowState === 'pending' ? ' pending' : ''}${flowState === 'stalled' ? ' stalled' : ''}`}
          style={{
            clipPath: 'inset(0 calc((100 - var(--gauge-pct, 0)) * 1%) 0 0)',
            transition: 'opacity 200ms',
          }}
        />
      </div>
    </div>
  );
}

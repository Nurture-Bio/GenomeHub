import { useRef, useState, useEffect } from 'react';

/**
 * RiverGauge — universal capacity/progress bar.
 *
 * Two physics modes:
 *   **tide**  — bidirectional. Filters raise and lower the bar freely.
 *   **waterfall** — monotonic. Persistent ratchet via refs. The bar only
 *     surges forward. At 100% it glows, settles, then dissolves.
 *
 * The bezier curve is always on. The ratchet is the guard, not the toggle.
 * The only moment of `transition: none` is the single reset frame.
 */
export default function RiverGauge({
  current,
  total,
  pending,
  accent,
  compact,
  variant = 'tide',
  resetKey,
}: {
  current: number;
  total: number;
  pending?: boolean;
  /** Highlight the readout in cyan. */
  accent?: boolean;
  compact?: boolean;
  /** 'tide' = bidirectional, 'waterfall' = monotonic with terminal dissolve. */
  variant?: 'tide' | 'waterfall';
  /** When this changes, the waterfall resets its high-water mark. */
  resetKey?: number | string;
}) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  const h = compact ? 10 : 16;

  // ── Persistent Ratchet (refs survive re-renders and parent decay) ──
  const maxPctRef = useRef(0);
  const prevResetKeyRef = useRef(resetKey);

  // ── Settle state: the dance must finish before dissolve ──
  const [settled, setSettled] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Snap-on-Reset: kill the transition for this one frame only
  let isResetting = false;
  if (resetKey !== prevResetKeyRef.current) {
    prevResetKeyRef.current = resetKey;
    maxPctRef.current = 0;
    isResetting = true;
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

  // The Persistent Curve — always on, never toggled
  // Reset frame gets 'none' to prevent the bar sliding from 100 → 0
  const clipTransition = isResetting
    ? 'none'
    : variant === 'waterfall'
      ? 'clip-path 600ms cubic-bezier(0.34, 1.56, 0.64, 1)'
      : 'clip-path 400ms cubic-bezier(0.34, 1.56, 0.64, 1)';

  const isTerminal = variant === 'waterfall' && displayPct >= 100;

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
      className="flex flex-col gap-1"
      style={{
        minWidth: compact ? 140 : 220,
        // Dissolve only after settled — the surge has finished its dance
        // 300ms delay lets the impact glow register before fade begins
        opacity: settled ? 0 : 1,
        transition: settled ? 'opacity 500ms ease-in 300ms' : undefined,
      }}
    >
      {/* Readout */}
      <div className="flex items-baseline gap-2 font-mono tabular-nums">
        <span
          className="font-bold"
          style={{
            fontSize: compact ? 'var(--font-size-lg)' : 'var(--font-size-2xl)',
            letterSpacing: '-0.02em',
            color: accent ? 'var(--color-cyan)' : 'var(--color-fg)',
            transition: 'color var(--t-fast)',
          }}
        >
          {current.toLocaleString()}
        </span>
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: 'var(--color-fg-3)',
            opacity: 0.5,
          }}
        >
          of {total.toLocaleString()}
        </span>
      </div>

      {/* The Conduit — fill is always 100% wide, clip-path reveals it */}
      <div className="w-full river-groove" style={{ height: h }}>
        <div
          className={`h-full river-fill${isTerminal ? ' river-impact' : ''}`}
          style={{
            clipPath: `inset(0 ${100 - displayPct}% 0 0)`,
            transition: `${clipTransition}, opacity 200ms`,
            opacity: pending ? 0.5 : 1,
            animation: pending ? 'distPlotBreath 1.5s ease-in-out infinite' : 'none',
          }}
        />
      </div>
    </div>
  );
}

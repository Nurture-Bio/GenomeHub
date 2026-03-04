import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Text } from './Text';

export interface StepperStep {
  key: string;
  label: string;
  error?: string;
}

export type StepHealth = 'normal' | 'warning' | 'error';

// ── SVG geometry ─────────────────────────────────────
//
// All rendering is pure SVG. Continuous animations use only
// transform + opacity (GPU-composited). One-shot transitions
// use stroke/fill (SVG-internal paint, no surrounding repaint).

const R = 7; // outer ring radius
const CORE = 2.5; // inner core radius
const RING = 1.5; // ring stroke width
const GAP = 48; // center-to-center node spacing
const PAD = 4; // connector inset from ring edge
const MX = 20; // SVG horizontal margin (room for ping at scale 2.5)
const CY = 22; // vertical center
const H = 44; // SVG height
const CONN_W = 1.5; // connector stroke width
const GLOW_W = 6; // flourish glow line width (fake glow via opacity)

const STEP_PACE_MS = 382; // 1000/φ² — must match CSS --t-phi

// derived
const CONN = GAP - 2 * R - 2 * PAD; // connector line length (26px)

function accentFor(h: StepHealth): string {
  return h === 'error'
    ? 'var(--color-red)'
    : h === 'warning'
      ? 'var(--color-amber)'
      : 'var(--color-cyan)';
}

/**
 * Stepper — pure SVG state engine display.
 *
 * Visual state is decoupled from data state. The incoming `active`
 * prop is the data truth; internally the Stepper maintains a
 * `visualActive` that catches up one step at a time with a pacing
 * delay, ensuring every connector sweep and node ping plays out
 * even when the backend blows through phases in milliseconds.
 *
 * Error messages live on StepperStep.error — rendered natively.
 */
export default function Stepper({
  steps,
  active: dataActive,
  header,
  detail,
  stepHealth,
  opacity,
  busy,
}: {
  steps: readonly StepperStep[];
  active: number;
  header?: ReactNode;
  detail?: ReactNode;
  stepHealth?: Record<string, StepHealth>;
  opacity?: number;
  /** When true on the final step, suppresses the flourish and pulses instead. */
  busy?: boolean;
}) {
  const n = steps.length;

  // ── Visual pacing: catch-up loop ───────────────────
  const [visualActive, setVisualActive] = useState(dataActive);

  useEffect(() => {
    // Reset backward immediately (cancel, restart, error)
    if (dataActive < visualActive) {
      setVisualActive(dataActive);
      return;
    }
    // Catch up one step at a time
    if (dataActive > visualActive) {
      const timer = setTimeout(() => {
        setVisualActive((prev) => prev + 1);
      }, STEP_PACE_MS);
      return () => clearTimeout(timer);
    }
  }, [dataActive, visualActive]);

  if (n === 0) return null;

  // ── All rendering uses visualActive ────────────────
  const active = visualActive;
  // Final step loses its flourish when busy — it pulses like an in-progress step
  const isFinal = active === n - 1 && !busy;
  const activeStep = steps[active];
  const activeKey = activeStep?.key;
  const activeError = activeStep?.error;

  // step.error takes precedence → always 'error' health
  const health: StepHealth = activeError
    ? 'error'
    : ((activeKey ? stepHealth?.[activeKey] : undefined) ?? 'normal');
  const accent = accentFor(health);

  const W = 2 * MX + (n - 1) * GAP;
  const cx = (i: number) => MX + i * GAP;

  return (
    <div
      className="rounded-md"
      style={{
        background: 'transparent',
        padding: '12px 16px',
        opacity: opacity ?? 1,
        transition: 'opacity var(--t-phi) var(--ease-phi)',
      }}
    >
      {header && <div className="mb-2">{header}</div>}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{
          display: 'block',
          maxWidth: '100%',
          height: 'auto',
          margin: '0 auto',
          overflow: 'visible',
        }}
        role="img"
        aria-label={`Step ${active + 1} of ${n}: ${activeStep?.label}`}
      >
        {/* ── Connectors ── */}
        {Array.from({ length: n - 1 }, (_, i) => {
          const reached = i + 1 <= active;
          const revealing = i + 1 === active && !isFinal;
          const x1 = cx(i) + R + PAD;
          const x2 = cx(i + 1) - R - PAD;

          return (
            <g key={`c${i}`}>
              <line
                x1={x1}
                y1={CY}
                x2={x2}
                y2={CY}
                stroke={reached || revealing ? 'var(--color-cyan)' : 'var(--color-line)'}
                strokeWidth={CONN_W}
                strokeLinecap="round"
                style={{ transition: 'stroke var(--t-phi) var(--ease-phi)' }}
              />
              {revealing && (
                <line
                  key={`r${active}`}
                  x1={x1}
                  y1={CY}
                  x2={x2}
                  y2={CY}
                  stroke={accent}
                  strokeWidth={CONN_W}
                  strokeLinecap="round"
                  strokeDasharray={CONN}
                  strokeDashoffset={CONN}
                  className="stepper-reveal"
                />
              )}
              {isFinal && reached && (
                <line
                  x1={x1}
                  y1={CY}
                  x2={x2}
                  y2={CY}
                  stroke="var(--color-cyan)"
                  strokeWidth={GLOW_W}
                  strokeLinecap="round"
                  className="stepper-conn-flourish"
                  style={{ animationDelay: `${(i + 1) * 60}ms` }}
                />
              )}
            </g>
          );
        })}

        {/* ── Nodes ── */}
        {steps.map((step, i) => {
          const reached = i <= active;
          const current = i === active;
          const pulsing = current && !isFinal;

          const color = current ? accent : reached ? 'var(--color-cyan)' : 'var(--color-line)';

          return (
            <g key={step.key} transform={`translate(${cx(i)},${CY})`}>
              {isFinal && reached && (
                <circle
                  r={R}
                  fill="var(--color-cyan)"
                  className="stepper-flourish-ping"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              )}

              {pulsing && (
                <circle
                  r={R}
                  fill={accent}
                  className="stepper-ping"
                  style={health === 'error' ? { animationDuration: '1.2s' } : undefined}
                />
              )}

              <g
                className={isFinal && reached ? 'stepper-flourish' : undefined}
                style={isFinal && reached ? { animationDelay: `${i * 80}ms` } : undefined}
              >
                <circle
                  r={R}
                  fill="none"
                  stroke={color}
                  strokeWidth={RING}
                  style={{ transition: 'stroke var(--t-phi) var(--ease-phi)' }}
                />
                <circle
                  r={CORE}
                  fill={color}
                  style={{
                    transform: reached ? 'scale(1)' : 'scale(0)',
                    transition:
                      'transform var(--t-phi) var(--ease-phi), fill var(--t-phi) var(--ease-phi)',
                    willChange: 'transform',
                  }}
                />
              </g>
            </g>
          );
        })}
      </svg>

      {/* Active step label */}
      <div className="text-center mt-2">
        <Text
          variant="dim"
          style={{
            fontSize: 'var(--font-size-xs)',
            fontFamily: 'var(--font-mono)',
            color: isFinal
              ? 'var(--color-cyan)'
              : health === 'error'
                ? 'var(--color-red)'
                : health === 'warning'
                  ? 'var(--color-amber)'
                  : 'var(--color-fg-2)',
            animation: isFinal ? 'flourishLabel 1000ms var(--ease-phi) both' : 'none',
            transition: 'color var(--t-phi) var(--ease-phi)',
          }}
        >
          {activeStep?.label}
        </Text>
      </div>

      {/* Error message — rendered natively from step.error */}
      {activeError && (
        <div className="text-center mt-1">
          <Text
            variant="dim"
            style={{
              fontSize: 'var(--font-size-xs)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-red)',
            }}
          >
            {activeError}
          </Text>
        </div>
      )}

      {detail && <div className="mt-2">{detail}</div>}
    </div>
  );
}

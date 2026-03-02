import type { ReactNode } from 'react';
import { Text } from './Text';

export interface StepperStep {
  key: string;
  label: string;
}

export type StepHealth = 'normal' | 'warning' | 'error';

/**
 * Stepper — the state engine display. Center of attention during multi-stage workflows.
 *
 * Renders on its own void backdrop so it reads correctly regardless of parent surface.
 * Layout order: header → dot chain → active label → detail.
 *
 * When the final step is reached, all dots fire a staggered flourish animation
 * and the label lands in cyan with a scale entrance.
 *
 * Per-dot health coloring: only the active dot reflects stepHealth.
 * Reached dots behind active stay cyan (they succeeded). Unreached dots stay --color-line.
 */
export default function Stepper({ steps, active, header, detail, stepHealth, opacity }: {
  steps: readonly StepperStep[];
  active: number;
  header?: ReactNode;
  detail?: ReactNode;
  stepHealth?: Record<string, StepHealth>;
  opacity?: number;
}) {
  const isFinal = active === steps.length - 1;
  const activeKey = steps[active]?.key;
  const health = (activeKey && stepHealth?.[activeKey]) ?? 'normal';

  // Color tokens per health state (only applied to the active dot)
  const healthColor = health === 'error'
    ? 'var(--color-red)'
    : health === 'warning'
      ? 'var(--color-amber)'
      : 'var(--color-cyan)';

  const healthGlow = health === 'error'
    ? '0 0 8px var(--color-red), 0 0 16px oklch(0.650 0.200 25 / 0.15)'
    : health === 'warning'
      ? '0 0 8px var(--color-amber), 0 0 16px oklch(0.750 0.185 60 / 0.15)'
      : '0 0 8px var(--color-cyan), 0 0 16px oklch(0.750 0.180 195 / 0.15)';

  const healthAnim = health === 'error'
    ? 'errorFlash 1.5s ease-in-out infinite'
    : 'pulse 1.5s ease-in-out infinite';

  return (
    <div
      className="rounded-md"
      style={{
        background: 'var(--color-void)',
        padding: '12px 16px',
        opacity: opacity ?? 1,
        transition: 'opacity var(--t-phi) var(--ease-phi)',
      }}
    >
      {/* Header slot — progress bar above the dots */}
      {header && <div className="mb-2">{header}</div>}

      {/* Dot chain */}
      <div
        className="flex items-center justify-center gap-1.5"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}
      >
        {steps.map((step, i) => {
          const reached = i <= active;
          const current = i === active;
          const pulsing = current && !isFinal;

          // Active dot uses health color; reached-behind stays cyan; unreached is line
          const dotColor = current
            ? healthColor
            : reached
              ? 'var(--color-cyan)'
              : 'var(--color-line)';

          const connColor = reached ? (current ? healthColor : 'var(--color-cyan)') : 'var(--color-line)';

          return (
            <span key={step.key} className="flex items-center gap-1.5">
              {i > 0 && (
                <span
                  style={{
                    display: 'block',
                    width: 16,
                    height: isFinal ? 2 : 1,
                    borderRadius: 1,
                    background: connColor,
                    boxShadow: isFinal && reached ? '0 0 6px oklch(0.750 0.180 195 / 0.3)' : 'none',
                    transition: 'background var(--t-phi) var(--ease-phi), height var(--t-phi) var(--ease-phi), box-shadow var(--t-phi) var(--ease-phi)',
                  }}
                />
              )}
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: dotColor,
                  boxShadow: pulsing
                    ? healthGlow
                    : isFinal && reached
                      ? '0 0 6px oklch(0.750 0.180 195 / 0.15)'
                      : reached
                        ? '0 0 4px oklch(0.750 0.180 195 / 0.1)'
                        : 'none',
                  animation: pulsing
                    ? healthAnim
                    : isFinal && reached
                      ? `flourish 618ms var(--ease-phi) ${i * 60}ms both`
                      : 'none',
                  transition: 'background var(--t-phi) var(--ease-phi), box-shadow var(--t-phi) var(--ease-phi)',
                }}
              />
            </span>
          );
        })}
      </div>

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
          {steps[active]?.label}
        </Text>
      </div>

      {/* Optional detail slot — progress bars, stats, etc. */}
      {detail && (
        <div className="mt-2">
          {detail}
        </div>
      )}
    </div>
  );
}

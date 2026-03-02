import { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cx } from 'class-variance-authority';
import { statusDot, button, input, modalOverlay } from '../ui/recipes';
import { Text, Heading, ComboBox, FilterChip, Stepper } from '../ui';
import type { ComboBoxItem, StepperStep, StepHealth } from '../ui';
import { FORMAT_META } from '../lib/formats';
import {
  useEnginesQuery,
  useEngineMethodsQuery,
  useFilesQuery,
  useCollectionsQuery,
} from '../hooks/useGenomicQueries';
import type { EngineMethod, EngineStatus } from '../hooks/useGenomicQueries';
import { useEngineMethod } from '../hooks/useEngineMethod';
import type { Phase } from '../hooks/useEngineMethod';

// ── Progress helpers ──────────────────────────────────

function formatEta(seconds: number): string {
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ── Step builder ──────────────────────────────────────

const HUB_STEPS_PRE:  StepperStep[] = [{ key: 'dispatch', label: 'Dispatching' }];
const HUB_STEPS_POST: StepperStep[] = [{ key: 'saving', label: 'Saving result' }, { key: 'complete', label: 'Complete' }];
const DEFAULT_ENGINE_STEPS: StepperStep[] = [{ key: 'processing', label: 'Processing' }];

function buildStepperSteps(method: EngineMethod): StepperStep[] {
  const engineSteps = method.steps?.length ? method.steps : DEFAULT_ENGINE_STEPS;
  return [...HUB_STEPS_PRE, ...engineSteps, ...HUB_STEPS_POST];
}

function resolveActiveStep(
  phase: Phase,
  pollStatus: string | null,
  pollStep: string | null,
  steps: StepperStep[],
  failedAtStep: number | null,
): number {
  if (phase === 'failing' || phase === 'fading') {
    return failedAtStep != null && failedAtStep >= 0 ? failedAtStep : steps.length - 1;
  }
  if (phase === 'completing') return steps.length - 1;  // Complete
  if (phase === 'dispatching') return 0;  // Dispatching

  // phase === 'active': use poll data
  if (pollStatus === 'saving') return steps.length - 2;  // Saving
  if (pollStatus === 'queued') return 0;  // Still at Dispatching
  if (pollStep) {
    const idx = steps.findIndex(s => s.key === pollStep);
    if (idx >= 0) return idx;
  }
  return 1;  // Default to first engine step
}

function deriveStepHealth(
  phase: Phase,
  pollLost: boolean,
  activeStep: number,
  steps: StepperStep[],
): Record<string, StepHealth> {
  const h: Record<string, StepHealth> = {};
  if (pollLost && steps[activeStep]) {
    h[steps[activeStep].key] = 'warning';
  }
  if (phase === 'failing' && steps[activeStep]) {
    h[steps[activeStep].key] = 'error';
  }
  return h;
}

// ── Schema-driven method form ─────────────────────────

function MethodForm({ engineId, method }: { engineId: string; method: EngineMethod }) {
  const { data: files } = useFilesQuery();
  const { data: collections } = useCollectionsQuery();
  const engine = useEngineMethod();
  const [params, setParams] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const p of method.parameters) {
      if (p.default !== undefined) defaults[p.name] = p.default;
    }
    return defaults;
  });
  const [fmtFilter,  setFmtFilter]  = useState('');
  const [orgFilter,  setOrgFilter]  = useState('');
  const [colFilter,  setColFilter]  = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const hasFileParams = method.parameters.some(p => p.type === 'file');

  const readyFiles = useMemo(() => (files ?? []).filter(f => f.status === 'ready'), [files]);

  const formatItems = useMemo(() => {
    const fmts = new Set(readyFiles.map(f => f.format));
    return Array.from(fmts).sort().map(f => ({ id: f, label: FORMAT_META[f]?.label ?? f }));
  }, [readyFiles]);

  const orgItems = useMemo(() => {
    const orgs = new Map<string, string>();
    readyFiles.forEach(f => f.organisms.forEach(o => orgs.set(o.id, o.displayName)));
    return Array.from(orgs.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => ({ id, label }));
  }, [readyFiles]);

  const colItems = useMemo(() => {
    return (collections ?? []).map(c => ({ id: c.id, label: c.name }));
  }, [collections]);

  const typeItems = useMemo(() => {
    const types = new Set(readyFiles.flatMap(f => f.types).filter(Boolean));
    return Array.from(types).sort().map(t => ({ id: t, label: t }));
  }, [readyFiles]);

  const filteredFiles = readyFiles
    .filter(f => !fmtFilter || f.format === fmtFilter)
    .filter(f => !orgFilter || f.organisms.some(o => o.id === orgFilter))
    .filter(f => !colFilter || f.collections.some(c => c.id === colFilter))
    .filter(f => !typeFilter || f.types.includes(typeFilter));

  const fileItemsFor = (accept?: string[]): ComboBoxItem[] =>
    (accept ? filteredFiles.filter(f => accept.includes(f.format)) : filteredFiles)
      .map(f => ({ id: f.id, label: f.filename, group: f.format.toUpperCase() }));

  const allRequiredFilled = method.parameters
    .filter(p => p.required)
    .every(p => params[p.name]);

  const handleRun = () => {
    engine.run(engineId, method.id, params);
  };

  const isActive = engine.phase !== 'idle';

  // Build dynamic stepper steps from method schema
  const stepperSteps = useMemo(() => buildStepperSteps(method), [method]);
  const activeStep = resolveActiveStep(engine.phase, engine.pollStatus, engine.pollStep, stepperSteps, engine.failedAtStep);
  const stepHealth = deriveStepHealth(engine.phase, engine.pollLost, activeStep, stepperSteps);

  return (
    <div className="flex flex-col gap-2 py-2 border-t border-line">
      {/* Form — hidden when active, preserved in DOM */}
      <div style={{
        opacity: isActive ? 0 : 1,
        pointerEvents: isActive ? 'none' : 'auto',
        transition: 'opacity var(--t-phi) var(--ease-phi)',
        position: isActive ? 'absolute' : 'relative',
        visibility: isActive ? 'hidden' : 'visible',
      }}>
        <div className="flex flex-col gap-2">
          <div>
            <Text variant="body" className="font-semibold">{method.name}</Text>
            <Text variant="dim" as="div" className="mt-0.5">{method.description}</Text>
          </div>

          {hasFileParams && (formatItems.length > 1 || orgItems.length > 1 || colItems.length > 1 || typeItems.length > 1) && (
            <div className="flex gap-1 flex-wrap">
              {formatItems.length > 1 && (
                <FilterChip label="All formats" items={formatItems} value={fmtFilter} onValueChange={setFmtFilter} />
              )}
              {orgItems.length > 1 && (
                <FilterChip label="All organisms" items={orgItems} value={orgFilter} onValueChange={setOrgFilter} />
              )}
              {colItems.length > 1 && (
                <FilterChip label="All collections" items={colItems} value={colFilter} onValueChange={setColFilter} />
              )}
              {typeItems.length > 1 && (
                <FilterChip label="All types" items={typeItems} value={typeFilter} onValueChange={setTypeFilter} />
              )}
            </div>
          )}

          {method.parameters.map(p => (
            <div key={p.name} className="flex flex-col gap-0.5">
              <Text variant="muted">{p.name.replace(/_/g, ' ')}{p.required ? '' : ' (optional)'}</Text>
              {p.type === 'file' ? (
                <ComboBox
                  items={fileItemsFor(p.accept)}
                  value={params[p.name] ?? ''}
                  onValueChange={v => setParams(prev => ({ ...prev, [p.name]: v }))}
                  placeholder={p.description}
                  size="sm"
                />
              ) : p.type === 'select' && p.options?.length ? (
                <>
                  <ComboBox
                    items={p.options.map(o => ({ id: o.value, label: o.label, description: o.description }))}
                    value={params[p.name] ?? p.default ?? ''}
                    onValueChange={v => setParams(prev => ({ ...prev, [p.name]: v }))}
                    placeholder={p.description}
                    size="sm"
                  />
                  {(() => {
                    const sel = p.options!.find(o => o.value === (params[p.name] ?? p.default));
                    return sel?.parameters ? (
                      <div className="flex gap-1.5 flex-wrap mt-0.5">
                        {Object.entries(sel.parameters).map(([k, v]) => (
                          <span key={k} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm bg-raised font-mono" style={{ fontSize: '0.8em' }}>
                            <span className="text-fg-3">{k.replace(/_/g, ' ')}</span>
                            <span className="text-cyan">{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </>
              ) : (
                <input
                  className={input({ variant: 'default', size: 'sm' })}
                  placeholder={p.default ?? p.description}
                  value={params[p.name] ?? ''}
                  onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                />
              )}
            </div>
          ))}

          {/* Output name */}
          <div className="flex flex-col gap-0.5">
            <Text variant="muted">output name</Text>
            <input
              className={input({ variant: 'default', size: 'sm' })}
              placeholder={`${method.id}_result`}
              value={params._outputName ?? ''}
              onChange={e => setParams(prev => ({ ...prev, _outputName: e.target.value }))}
            />
          </div>

          <button
            className={cx(button({ intent: 'primary', size: 'sm' }), 'mt-1')}
            disabled={!allRequiredFilled}
            onClick={handleRun}
          >
            Run
          </button>
        </div>
      </div>

      {/* Stepper — shown when active */}
      {isActive && (
        <MethodProgress
          steps={stepperSteps}
          activeStep={activeStep}
          stepHealth={stepHealth}
          opacity={engine.phase === 'fading' ? 0 : 1}
          engine={engine}
          onCancel={engine.phase === 'active' || engine.phase === 'dispatching' ? engine.cancel : undefined}
        />
      )}
    </div>
  );
}

// ── Engine method stepper ──────────────────────────────

function MethodProgress({ steps, activeStep, stepHealth, opacity, engine, onCancel }: {
  steps: StepperStep[];
  activeStep: number;
  stepHealth: Record<string, StepHealth>;
  opacity: number;
  engine: ReturnType<typeof useEngineMethod>;
  onCancel?: () => void;
}) {
  const { progress, pollLost, stage, items } = engine;
  const pct = progress?.pct_complete != null ? Math.round(progress.pct_complete * 100) : null;

  // Header slot — progress bar above dots
  const header = pct != null ? (
    <div className="flex flex-col gap-1.5">
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-raised)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: pollLost ? 'var(--color-amber-dim)' : 'var(--color-cyan)',
            transition: 'width 500ms ease-out, background var(--t-phi) var(--ease-phi)',
          }}
        />
      </div>
      <div className="flex gap-2.5 font-mono justify-center" style={{ fontSize: 'var(--font-size-xs)' }}>
        <Text variant="dim">{pct}%</Text>
        {progress!.eta_seconds != null && (
          <Text variant="dim">ETA {formatEta(progress!.eta_seconds)}</Text>
        )}
        {progress!.rate_per_sec != null && (
          <Text variant="dim">{progress!.rate_per_sec.toFixed(1)}/s</Text>
        )}
      </div>
    </div>
  ) : null;

  // Detail slot — below the step label
  const detail = (
    <div className="flex flex-col gap-2">
      {/* Stage sublabel */}
      {stage && (
        <Text variant="dim" className="text-center font-mono" style={{ fontSize: 'var(--font-size-xs)' }}>
          {stage}
        </Text>
      )}
      {/* n/x item counter */}
      {items && (
        <Text variant="dim" className="text-center font-mono" style={{ fontSize: 'var(--font-size-xs)' }}>
          {items.complete} / {items.total}
        </Text>
      )}
      {/* Connection lost warning */}
      {pollLost && (
        <div
          className="flex items-center justify-center gap-1.5 rounded-sm font-mono"
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-amber)',
            background: 'var(--color-amber-wash)',
            padding: '4px 8px',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        >
          Connection lost — retrying...
        </div>
      )}
      {/* Cancel button */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="self-center font-mono cursor-pointer border rounded-sm transition-colors"
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-amber)',
            borderColor: 'var(--color-amber-dim)',
            background: 'var(--color-amber-wash)',
            padding: '4px 12px',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-amber-dim)';
            e.currentTarget.style.color = 'var(--color-void)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--color-amber-wash)';
            e.currentTarget.style.color = 'var(--color-amber)';
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );

  return (
    <div className="mt-1">
      <Stepper
        steps={steps}
        active={activeStep}
        header={header}
        detail={detail}
        stepHealth={stepHealth}
        opacity={opacity}
      />
    </div>
  );
}

// ── Engine method dialog ──────────────────────────────

function EngineMethodDialog({
  engine,
  open,
  onOpenChange,
}: {
  engine: EngineStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: methods, isLoading } = useEngineMethodsQuery(open ? engine.id : undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = methods?.find(m => m.id === selectedId) ?? null;

  const handleClose = (o: boolean) => {
    if (!o) setSelectedId(null);
    onOpenChange(o);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className={modalOverlay()} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-modal
                     bg-elevated border border-line rounded-lg shadow-lg
                     p-3 w-full max-w-embed mx-2 max-h-[80vh] overflow-y-auto animate-fade-in"
          onPointerDownOutside={() => handleClose(false)}
        >
          <Dialog.Title asChild>
            <Heading level="subheading" className="mb-1">{engine.name}</Heading>
          </Dialog.Title>

          {isLoading && <Text variant="dim" className="py-3">Loading methods...</Text>}

          {!isLoading && methods?.length === 0 && (
            <Text variant="dim" className="py-3">No methods available</Text>
          )}

          {selected ? (
            <>
              <button
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1 bg-transparent border-none cursor-pointer p-0 mb-2 text-fg-3 hover:text-cyan transition-colors duration-fast font-sans text-body"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                  <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                All methods
              </button>
              <MethodForm engineId={engine.id} method={selected} />
            </>
          ) : (
            methods && methods.length > 0 && (
              <>
                <Dialog.Description asChild>
                  <Text variant="dim" className="mb-2">Select a method to run</Text>
                </Dialog.Description>
                <div className="flex flex-col gap-0.5">
                  {methods.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedId(m.id)}
                      className="flex flex-col gap-0.5 p-2 rounded-sm bg-transparent border border-line cursor-pointer
                                 hover:border-cyan hover:bg-base transition-colors duration-fast text-left"
                    >
                      <Text variant="body" className="font-semibold">{m.name}</Text>
                      <Text variant="dim" as="div">{m.description}</Text>
                      <Text variant="dim" className="text-fg-3">{m.parameters.length} parameter{m.parameters.length !== 1 ? 's' : ''}</Text>
                    </button>
                  ))}
                </div>
              </>
            )
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Sidebar engine list ─────────────────────────────────

export default function EnginePanel() {
  const { data: engines } = useEnginesQuery();
  const running = engines?.filter(e => e.status === 'ok');
  const [selectedEngine, setSelectedEngine] = useState<EngineStatus | null>(null);

  if (!running?.length) return null;
  return (
    <>
      <div className="flex flex-col gap-0.5 px-4 py-2 border-t border-line">
        <Text variant="muted">Engines</Text>
        {running.map(e => (
          <button
            key={e.id}
            onClick={() => setSelectedEngine(e)}
            className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-left hover:opacity-80 transition-opacity"
          >
            <div className={statusDot({ status: 'connected', size: 'sm' })} />
            <Text variant="dim">{e.name}</Text>
          </button>
        ))}
      </div>

      {selectedEngine && (
        <EngineMethodDialog
          engine={selectedEngine}
          open={!!selectedEngine}
          onOpenChange={open => { if (!open) setSelectedEngine(null); }}
        />
      )}
    </>
  );
}

import { useState, useMemo, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cx } from 'class-variance-authority';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { statusDot, button, input, modalOverlay } from '../ui/recipes';
import { Text, Heading, ComboBox, FilterChip } from '../ui';
import type { ComboBoxItem } from '../ui';
import { FORMAT_META } from '../lib/formats';
import { queryKeys } from '../lib/queryKeys';
import { apiFetch } from '../lib/api';
import {
  useEnginesQuery,
  useEngineMethodsQuery,
  useRunMethodMutation,
  useEngineJobQuery,
  useFilesQuery,
  useCollectionsQuery,
} from '../hooks/useGenomicQueries';
import type { EngineMethod, EngineStatus } from '../hooks/useGenomicQueries';
import { toast } from 'sonner';

// ── Progress helpers ──────────────────────────────────────

function formatEta(seconds: number): string {
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ── Schema-driven method form ─────────────────────────────

function MethodForm({ engineId, method }: { engineId: string; method: EngineMethod }) {
  const qc = useQueryClient();
  const { data: files } = useFilesQuery();
  const { data: collections } = useCollectionsQuery();
  const { runMethod, pending } = useRunMethodMutation();
  const [params, setParams] = useState<Record<string, string>>({});
  const [fmtFilter,  setFmtFilter]  = useState('');
  const [orgFilter,  setOrgFilter]  = useState('');
  const [colFilter,  setColFilter]  = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: jobStatus } = useEngineJobQuery(activeJobId ?? undefined);

  // Watch for job completion or failure
  useEffect(() => {
    if (!jobStatus) return;
    if (jobStatus.status === 'complete') {
      qc.invalidateQueries({ queryKey: queryKeys.files.all });
      qc.invalidateQueries({ queryKey: queryKeys.stats.storage });
      toast.success(
        jobStatus.fileId
          ? <Link to={`/files/${jobStatus.fileId}`} className="no-underline hover:underline">{jobStatus.filename ?? 'View result'}</Link>
          : (jobStatus.filename ?? 'Done'),
      );
      setActiveJobId(null);
    } else if (jobStatus.status === 'failed') {
      toast.error(jobStatus.error ?? 'Method failed');
      setActiveJobId(null);
    }
  }, [jobStatus, qc]);

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

  const handleRun = async () => {
    try {
      const result = await runMethod({ engineId, methodId: method.id, params });
      if (result?.jobId) {
        setActiveJobId(result.jobId);
      }
    } catch {
      // onError in mutation handles the toast
    }
  };

  const handleCancel = async () => {
    if (!activeJobId) return;
    try {
      await apiFetch(`/api/engines/jobs/${activeJobId}`, { method: 'DELETE' });
    } catch { /* best-effort */ }
    setActiveJobId(null);
  };

  const isRunning = pending || !!activeJobId;
  const progress  = jobStatus?.progress ?? null;

  return (
    <div className="flex flex-col gap-2 py-2 border-t border-line">
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

      {/* Run button / progress area */}
      {activeJobId && progress ? (
        <div className="mt-1 flex flex-col gap-1.5">
          {progress.pct_complete !== null ? (
            <>
              {/* Progress bar */}
              <div className="h-1 rounded-full bg-raised overflow-hidden">
                <div
                  className="h-full bg-cyan rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.round(progress.pct_complete * 100)}%` }}
                />
              </div>
              {/* Live stats */}
              <div className="flex gap-2.5 font-mono">
                <Text variant="dim">{Math.round(progress.pct_complete * 100)}%</Text>
                {progress.eta_seconds !== null && (
                  <Text variant="dim">ETA {formatEta(progress.eta_seconds)}</Text>
                )}
                {progress.rate_per_sec !== null && (
                  <Text variant="dim">{progress.rate_per_sec.toFixed(1)}/s</Text>
                )}
              </div>
            </>
          ) : (
            /* Indeterminate progress bar while pct_complete is null */
            <div className="flex flex-col gap-1.5">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-raised)' }}>
                <div className="h-full w-[60%] progress-stripe" style={{ background: 'var(--color-cyan)' }} />
              </div>
              <Text variant="dim">Running...</Text>
            </div>
          )}
          <button
            type="button"
            onClick={handleCancel}
            className="self-start font-sans text-body text-fg-3 hover:text-red transition-colors duration-fast bg-transparent border-none cursor-pointer p-0 leading-none"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className={cx(button({ intent: 'primary', size: 'sm', pending: isRunning }), 'mt-1')}
          disabled={!allRequiredFilled || isRunning}
          onClick={handleRun}
        >
          {isRunning ? 'Running...' : 'Run'}
        </button>
      )}
    </div>
  );
}

// ── Engine method dialog ──────────────────────────────────

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

// ── Sidebar engine list ─────────────────────────────────────

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

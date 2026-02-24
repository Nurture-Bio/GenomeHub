import { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cx } from 'class-variance-authority';
import { statusDot, button, input, modalOverlay } from '../ui/recipes';
import { Text, Heading, ComboBox, FilterChip } from '../ui';
import type { ComboBoxItem } from '../ui';
import { FORMAT_META } from '../lib/formats';
import {
  useEnginesQuery,
  useEngineMethodsQuery,
  useRunMethodMutation,
  useFilesQuery,
  useCollectionsQuery,
} from '../hooks/useGenomicQueries';
import type { EngineMethod, EngineStatus } from '../hooks/useGenomicQueries';

// ── Schema-driven method form ─────────────────────────────

function MethodForm({ engineId, method }: { engineId: string; method: EngineMethod }) {
  const { data: files } = useFilesQuery();
  const { data: collections } = useCollectionsQuery();
  const { runMethod, pending } = useRunMethodMutation();
  const [params, setParams] = useState<Record<string, string>>({});
  const [fmtFilter, setFmtFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [colFilter, setColFilter] = useState('');

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

  const fileItems: ComboBoxItem[] = readyFiles
    .filter(f => !fmtFilter || f.format === fmtFilter)
    .filter(f => !orgFilter || f.organisms.some(o => o.id === orgFilter))
    .filter(f => !colFilter || f.collections.some(c => c.id === colFilter))
    .map(f => ({ id: f.id, label: f.filename, group: f.format.toUpperCase() }));

  const allRequiredFilled = method.parameters
    .filter(p => p.required)
    .every(p => params[p.name]);

  const handleRun = () => {
    runMethod({ engineId, methodId: method.id, params });
  };

  return (
    <div className="flex flex-col gap-2 py-2 border-t border-line">
      <div>
        <Text variant="body" className="font-semibold">{method.name}</Text>
        <Text variant="dim" as="div" className="mt-0.5">{method.description}</Text>
      </div>

      {hasFileParams && (formatItems.length > 1 || orgItems.length > 1 || colItems.length > 1) && (
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
        </div>
      )}

      {method.parameters.map(p => (
        <div key={p.name} className="flex flex-col gap-0.5">
          <Text variant="muted">{p.name.replace(/_/g, ' ')}{p.required ? '' : ' (optional)'}</Text>
          {p.type === 'file' ? (
            <ComboBox
              items={p.accept
                ? fileItems.filter(f => {
                    const ext = f.label.split('.').pop()?.toLowerCase();
                    return ext && p.accept!.includes(ext);
                  })
                : fileItems}
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

      <button
        className={cx(button({ intent: 'primary', size: 'sm', pending }), 'mt-1')}
        disabled={!allRequiredFilled || pending}
        onClick={handleRun}
      >
        {pending ? 'Running...' : 'Run'}
      </button>
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
      <div className="flex flex-col gap-0.5 px-3 py-1.5 border-t border-line">
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

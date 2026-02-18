import { useState, useMemo } from 'react';
import {
  useExperimentsQuery, useCreateExperimentMutation,
  useProjectsQuery, useOrganismsQuery,
} from '../hooks/useGenomicQueries';
import { TECHNIQUE_META, TECHNIQUE_LIST, type Technique } from '../lib/techniques';
import { formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Select } from '../ui';

// ── Technique pill ───────────────────────────────────────

function TechniquePill({ technique }: { technique: string }) {
  const meta = TECHNIQUE_META[technique as Technique] ?? TECHNIQUE_META.other;
  return (
    <span className="font-mono text-micro px-1.5 py-0.5 rounded-sm inline-block"
      style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

// ── Skeleton row ─────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="py-2 pr-3">
          <div className="skeleton h-4 rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ── ExperimentsPage ──────────────────────────────────────

const TECHNIQUE_FILTERS = ['all', ...TECHNIQUE_LIST] as const;

export default function ExperimentsPage() {
  const { data, isLoading, refetch } = useExperimentsQuery();
  const { data: projects } = useProjectsQuery();
  const { data: organisms } = useOrganismsQuery();
  const { createExperiment, pending } = useCreateExperimentMutation(refetch);

  const [techFilter, setTechFilter] = useState<string>('all');

  // Create form state
  const [name,           setName]           = useState('');
  const [technique,      setTechnique]      = useState<string>('');
  const [projectId,      setProjectId]      = useState('');
  const [organismId,     setOrganismId]     = useState('');
  const [description,    setDescription]    = useState('');
  const [experimentDate, setExperimentDate] = useState('');

  const filtered = useMemo(() => {
    if (!data) return [];
    if (techFilter === 'all') return data;
    return data.filter(e => e.technique === techFilter);
  }, [data, techFilter]);

  const handleCreate = async () => {
    if (!name || !technique || !projectId) return;
    await createExperiment({
      name, technique, projectId,
      description: description || undefined,
      experimentDate: experimentDate || undefined,
      organismId: organismId || undefined,
    });
    setName(''); setTechnique(''); setProjectId('');
    setOrganismId(''); setDescription(''); setExperimentDate('');
  };

  return (
    <div className="flex flex-col gap-3 p-3 h-full min-h-0">
      {/* Header */}
      <div className="shrink-0">
        <Heading level="heading">Experiments</Heading>
        <Text variant="caption">
          {data ? `${data.length} experiment${data.length !== 1 ? 's' : ''}` : 'Loading\u2026'}
        </Text>
      </div>

      {/* Create form */}
      <div className="flex items-end gap-2 shrink-0 flex-wrap bg-surface border border-border rounded-md p-2.5">
        <div className="flex flex-col gap-0.5">
          <Text variant="overline">Name</Text>
          <Input variant="surface" size="sm" placeholder="Esa1 depletion timecourse" value={name} onChange={e => setName(e.target.value)} className="w-52" />
        </div>
        <div className="flex flex-col gap-0.5">
          <Text variant="overline">Technique</Text>
          <Select variant="surface" size="sm" value={technique} onChange={e => setTechnique(e.target.value)} className="w-36">
            <option value="">-- select --</option>
            {TECHNIQUE_LIST.map(t => (
              <option key={t} value={t}>{TECHNIQUE_META[t].label}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-0.5">
          <Text variant="overline">Project</Text>
          <Select variant="surface" size="sm" value={projectId} onChange={e => setProjectId(e.target.value)} className="w-36">
            <option value="">-- select --</option>
            {projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div className="flex flex-col gap-0.5">
          <Text variant="overline">Organism</Text>
          <Select variant="surface" size="sm" value={organismId} onChange={e => setOrganismId(e.target.value)} className="w-40">
            <option value="">-- none --</option>
            {organisms?.map(o => <option key={o.id} value={o.id}>{o.displayName}</option>)}
          </Select>
        </div>
        <div className="flex flex-col gap-0.5">
          <Text variant="overline">Date</Text>
          <Input variant="surface" size="sm" type="date" value={experimentDate} onChange={e => setExperimentDate(e.target.value)} className="w-32" />
        </div>
        <Button intent="primary" size="sm" pending={pending} onClick={handleCreate} disabled={!name || !technique || !projectId}>
          Add
        </Button>
      </div>

      {/* Technique filters */}
      <div className="flex gap-1 flex-wrap shrink-0">
        {TECHNIQUE_FILTERS.map(t => {
          const meta = t === 'all' ? null : TECHNIQUE_META[t as Technique];
          return (
            <button
              key={t}
              onClick={() => setTechFilter(t)}
              className="font-body text-micro px-1.5 py-0.5 rounded-sm border transition-colors duration-fast cursor-pointer"
              style={{
                background: techFilter === t
                  ? (meta?.color ?? 'var(--color-accent)')
                  : 'var(--color-surface-2)',
                color: techFilter === t ? 'var(--color-bg)' : 'var(--color-text-secondary)',
                borderColor: techFilter === t ? 'transparent' : 'var(--color-border)',
              }}
            >
              {t === 'all' ? 'All' : meta?.label ?? t}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0 border border-border rounded-md bg-surface">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-surface-2 z-10">
            <tr className="border-b border-border">
              {['Name', 'Technique', 'Organism', 'Project', 'PI / User', 'Date', 'Files'].map(h => (
                <th key={h} className="py-1.5 pr-3 pl-2.5 font-body text-micro uppercase tracking-overline text-text-dim font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
              : !filtered.length
                ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-text-dim font-body text-body">
                      {techFilter !== 'all' ? 'No experiments match this technique.' : 'No experiments yet. Create one above.'}
                    </td>
                  </tr>
                )
                : filtered.map(e => (
                  <tr key={e.id} className="border-b border-border-subtle transition-colors duration-fast hover:bg-surface group">
                    <td className="py-1.5 pl-2.5 pr-3">
                      <div className="font-mono text-caption text-text">{e.name}</div>
                      {e.description && <div className="text-micro text-text-dim truncate max-w-xs">{e.description}</div>}
                    </td>
                    <td className="py-1.5 pr-3"><TechniquePill technique={e.technique} /></td>
                    <td className="py-1.5 pr-3 text-caption text-text-secondary italic">
                      {e.organismDisplay ?? '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-caption text-text-secondary">{e.projectName ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-caption text-text-dim">{e.createdBy ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-caption text-text-dim whitespace-nowrap">
                      {e.experimentDate ?? '—'}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-caption tabular-nums text-text-secondary">
                      {e.fileCount}
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

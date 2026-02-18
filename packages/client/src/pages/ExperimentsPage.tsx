import { useState, useMemo } from 'react';
import {
  useExperimentsQuery, useCreateExperimentMutation,
  useExperimentTypesQuery,
} from '../hooks/useGenomicQueries';
import { techniqueColor, TechniquePill } from '../lib/techniqueColors';
import { formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Card } from '../ui';
import { ExperimentTypePicker, ProjectPicker, OrganismPicker } from '../ui';

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

export default function ExperimentsPage() {
  const { data, isLoading, refetch } = useExperimentsQuery();
  const { createExperiment, pending } = useCreateExperimentMutation(refetch);
  const { data: experimentTypes } = useExperimentTypesQuery();

  const [techFilter, setTechFilter] = useState<string>('all');

  // Create form state
  const [name,             setName]             = useState('');
  const [experimentTypeId, setExperimentTypeId] = useState('');
  const [projectId,        setProjectId]        = useState('');
  const [organismId,       setOrganismId]       = useState('');
  const [description,      setDescription]      = useState('');
  const [experimentDate,   setExperimentDate]   = useState('');

  const filtered = useMemo(() => {
    if (!data) return [];
    if (techFilter === 'all') return data;
    return data.filter(e => e.experimentTypeName === techFilter);
  }, [data, techFilter]);

  const handleCreate = async () => {
    if (!name || !experimentTypeId || !projectId) return;
    await createExperiment({
      name, projectId, experimentTypeId,
      description: description || undefined,
      experimentDate: experimentDate || undefined,
      organismId: organismId || undefined,
    });
    setName(''); setExperimentTypeId(''); setProjectId('');
    setOrganismId(''); setDescription(''); setExperimentDate('');
  };

  // Build filter list from DB experiment types
  const techniqueFilters = useMemo(() => {
    return ['all', ...(experimentTypes ?? []).map(t => t.name)];
  }, [experimentTypes]);

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {/* Header */}
      <div className="shrink-0">
        <Heading level="heading">Experiments</Heading>
        <Text variant="caption">
          {data ? `${data.length} experiment${data.length !== 1 ? 's' : ''}` : 'Loading\u2026'}
        </Text>
      </div>

      {/* Create form — wraps, full-width inputs on mobile */}
      <div className="flex items-end gap-2 shrink-0 flex-wrap bg-surface border border-border rounded-md p-2.5">
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Name</Text>
          <Input variant="surface" size="sm" placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="w-full sm:w-52" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Technique</Text>
          <ExperimentTypePicker
            value={experimentTypeId}
            onValueChange={setExperimentTypeId}
            variant="surface"
            size="sm"
            className="w-full sm:w-36"
          />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Project</Text>
          <ProjectPicker
            value={projectId}
            onValueChange={setProjectId}
            variant="surface"
            size="sm"
            className="w-full sm:w-36"
          />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Organism</Text>
          <OrganismPicker
            value={organismId}
            onValueChange={setOrganismId}
            variant="surface"
            size="sm"
            className="w-full sm:w-40"
          />
        </div>
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Description</Text>
          <Input variant="surface" size="sm" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} className="w-full sm:w-52" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Date</Text>
          <Input variant="surface" size="sm" type="date" value={experimentDate} onChange={e => setExperimentDate(e.target.value)} className="w-full sm:w-32" />
        </div>
        <Button intent="primary" size="sm" pending={pending} onClick={handleCreate} disabled={!name || !experimentTypeId || !projectId} className="w-full sm:w-auto">
          Add
        </Button>
      </div>

      {/* Technique filters — touch-friendly on mobile */}
      <div className="flex gap-1 flex-wrap shrink-0">
        {techniqueFilters.map(t => {
          const colors = t === 'all' ? null : techniqueColor(t);
          return (
            <button
              key={t}
              onClick={() => setTechFilter(t)}
              className="font-body text-micro px-1.5 py-1 md:py-0.5 rounded-sm border transition-colors duration-fast cursor-pointer min-h-5.5 md:min-h-0"
              style={{
                background: techFilter === t
                  ? (colors?.color ?? 'var(--color-accent)')
                  : 'var(--color-surface-2)',
                color: techFilter === t ? 'var(--color-bg)' : 'var(--color-text-secondary)',
                borderColor: techFilter === t ? 'transparent' : 'var(--color-border)',
              }}
            >
              {t === 'all' ? 'All' : t}
            </button>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-border rounded-md bg-surface">
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
                    <td className="py-1.5 pr-3"><TechniquePill name={e.experimentTypeName ?? e.technique ?? 'Other'} /></td>
                    <td className="py-1.5 pr-3 text-caption text-text-secondary italic">
                      {e.organismDisplay ?? '\u2014'}
                    </td>
                    <td className="py-1.5 pr-3 text-caption text-text-secondary">{e.projectName ?? '\u2014'}</td>
                    <td className="py-1.5 pr-3 text-caption text-text-dim">{e.createdBy ?? '\u2014'}</td>
                    <td className="py-1.5 pr-3 text-caption text-text-dim whitespace-nowrap">
                      {e.experimentDate ?? '\u2014'}
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

      {/* Mobile cards */}
      <div className="flex flex-col gap-1.5 md:hidden flex-1 overflow-auto min-h-0">
        {isLoading
          ? [...Array(4)].map((_, i) => (
            <Card key={i} className="p-2.5">
              <div className="skeleton h-4 rounded-sm w-1/2 mb-1" />
              <div className="skeleton h-3 rounded-sm w-3/4" />
            </Card>
          ))
          : !filtered.length
            ? (
              <div className="py-8 text-center text-text-dim text-body font-body">
                {techFilter !== 'all' ? 'No experiments match this technique.' : 'No experiments yet. Create one above.'}
              </div>
            )
            : filtered.map(e => (
              <Card key={e.id} className="p-2.5 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <TechniquePill name={e.experimentTypeName ?? e.technique ?? 'Other'} />
                  <span className="font-mono text-caption text-text truncate flex-1 min-w-0">{e.name}</span>
                </div>
                {e.description && <Text variant="caption" className="truncate">{e.description}</Text>}
                <div className="flex items-center gap-2 flex-wrap">
                  {e.organismDisplay && <Text variant="caption" className="italic">{e.organismDisplay}</Text>}
                  {e.projectName && <Text variant="caption">{e.projectName}</Text>}
                  <Text variant="caption">{e.fileCount} files</Text>
                  {e.experimentDate && <Text variant="caption">{e.experimentDate}</Text>}
                </div>
              </Card>
            ))
        }
      </div>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useCollectionsQuery, useCreateCollectionMutation,
  useTechniquesQuery,
} from '../hooks/useGenomicQueries';
import { techniqueColor, TechniquePill } from '../lib/techniqueColors';
import { formatRelativeTime } from '../lib/formats';
import { Button, Badge, Input, Text, Heading, Card } from '../ui';
import { TechniquePicker, OrganismPicker } from '../ui';

// ── Skeleton row ─────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="py-2 pr-3">
          <div className="skeleton h-4 rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ── CollectionsPage ─────────────────────────────────────

export default function CollectionsPage() {
  const { data, isLoading, refetch } = useCollectionsQuery();
  const { createCollection, pending } = useCreateCollectionMutation(refetch);
  const { data: techniques } = useTechniquesQuery();

  const [techFilter, setTechFilter] = useState<string>('all');

  // Create form — only name is required. Everything else optional.
  const [name,         setName]         = useState('');
  const [techniqueId,  setTechniqueId]  = useState('');
  const [organismId,   setOrganismId]   = useState('');
  const [description,  setDescription]  = useState('');

  const filtered = useMemo(() => {
    if (!data) return [];
    if (techFilter === 'all') return data;
    return data.filter(c => c.techniqueName === techFilter);
  }, [data, techFilter]);

  const handleCreate = async () => {
    if (!name) return;
    await createCollection({
      name,
      techniqueId: techniqueId || undefined,
      organismId: organismId || undefined,
      description: description || undefined,
    });
    setName(''); setTechniqueId('');
    setOrganismId(''); setDescription('');
  };

  const techniqueFilters = useMemo(() => {
    return ['all', ...(techniques ?? []).map(t => t.name)];
  }, [techniques]);

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {/* Header */}
      <div className="shrink-0">
        <Heading level="heading">Collections</Heading>
        <Text variant="caption">
          {data ? `${data.length} collection${data.length !== 1 ? 's' : ''}` : 'Loading...'}
        </Text>
      </div>

      {/* Create form — only name required */}
      <div className="flex items-end gap-2 shrink-0 flex-wrap bg-surface border border-border rounded-md p-2.5">
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Name</Text>
          <Input variant="surface" size="sm" placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="w-full sm:w-52" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Technique</Text>
          <TechniquePicker
            value={techniqueId}
            onValueChange={setTechniqueId}
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
        <Button intent="primary" size="sm" pending={pending} onClick={handleCreate} disabled={!name} className="w-full sm:w-auto">
          Add
        </Button>
      </div>

      {/* Technique filters */}
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
              {['Name', 'Technique', 'Organism', 'Kind', 'Created by', 'Files'].map(h => (
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
                    <td colSpan={6} className="py-12 text-center text-text-dim font-body text-body">
                      {techFilter !== 'all' ? 'No collections match this technique.' : 'No collections yet. Create one above.'}
                    </td>
                  </tr>
                )
                : filtered.map(c => (
                  <tr key={c.id} className="border-b border-border-subtle transition-colors duration-fast hover:bg-surface group cursor-pointer"
                    onClick={() => window.location.hash = ''}
                  >
                    <td className="py-1.5 pl-2.5 pr-3">
                      <Link to={`/collections/${c.id}`} className="no-underline">
                        <div className="font-mono text-caption text-text">{c.name}</div>
                        {c.description && <div className="text-micro text-text-dim truncate max-w-xs">{c.description}</div>}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3"><TechniquePill name={c.techniqueName ?? 'Other'} /></td>
                    <td className="py-1.5 pr-3 text-caption text-text-secondary italic">
                      {c.organismDisplay ?? '--'}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge variant="count" color="dim">{c.kind}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-caption text-text-dim">{c.createdBy ?? '--'}</td>
                    <td className="py-1.5 pr-3 font-mono text-caption tabular-nums text-text-secondary">
                      {c.fileCount}
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
                {techFilter !== 'all' ? 'No collections match this technique.' : 'No collections yet. Create one above.'}
              </div>
            )
            : filtered.map(c => (
              <Link key={c.id} to={`/collections/${c.id}`} className="no-underline">
                <Card className="p-2.5 flex flex-col gap-1 hover:border-accent transition-colors duration-fast cursor-pointer">
                  <div className="flex items-center gap-2">
                    {c.techniqueName && <TechniquePill name={c.techniqueName} />}
                    <span className="font-mono text-caption text-text truncate flex-1 min-w-0">{c.name}</span>
                    <Badge variant="count" color="dim">{c.kind}</Badge>
                  </div>
                  {c.description && <Text variant="caption" className="truncate">{c.description}</Text>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.organismDisplay && <Text variant="caption" className="italic">{c.organismDisplay}</Text>}
                    <Text variant="caption">{c.fileCount} files</Text>
                  </div>
                </Card>
              </Link>
            ))
        }
      </div>
    </div>
  );
}

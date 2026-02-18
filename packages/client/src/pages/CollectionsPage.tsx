import { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  useCollectionsQuery, useCreateCollectionMutation,
  useUpdateCollectionMutation, useDeleteCollectionMutation,
  useTechniquesQuery,
} from '../hooks/useGenomicQueries';
import { techniqueColor, TechniquePill } from '../lib/techniqueColors';
import { Badge, Text, Heading, Card } from '../ui';
import { TechniquePicker, OrganismPicker } from '../ui';

// ── Inline picker cell (absolute overlay, zero layout shift) ─

function InlinePickerCell({
  children, editing, onStartEdit, picker,
}: {
  children: React.ReactNode;
  editing: boolean;
  onStartEdit: () => void;
  picker: React.ReactNode;
}) {
  return (
    <div className="relative min-h-5">
      <div
        className={`${editing ? 'invisible' : 'cursor-pointer hover:text-accent transition-colors duration-fast'}`}
        onClick={onStartEdit}
      >
        {children}
      </div>
      {editing && (
        <div className="absolute top-1/2 left-0 -translate-y-1/2 z-20">
          {picker}
        </div>
      )}
    </div>
  );
}

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
  const { createCollection, pending: createPending } = useCreateCollectionMutation(refetch);
  const { updateCollection } = useUpdateCollectionMutation(refetch);
  const { deleteCollection } = useDeleteCollectionMutation(refetch);
  const { data: techniques } = useTechniquesQuery();

  const [techFilter, setTechFilter] = useState<string>('all');

  // Inline picker state per-row
  const [editTech, setEditTech] = useState<string | null>(null);
  const [editOrg, setEditOrg] = useState<string | null>(null);

  // Inline add row state
  const [newName, setNewName] = useState('');
  const [newTechId, setNewTechId] = useState('');
  const [newOrgId, setNewOrgId] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (techFilter === 'all') return data;
    return data.filter(c => c.techniqueName === techFilter);
  }, [data, techFilter]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createCollection({
      name: newName.trim(),
      techniqueId: newTechId || undefined,
      organismId: newOrgId || undefined,
    });
    setNewName(''); setNewTechId(''); setNewOrgId('');
    nameRef.current?.focus();
  };

  const handleUpdateTechnique = async (id: string, techniqueId: string) => {
    await updateCollection(id, { techniqueId: techniqueId || undefined });
    setEditTech(null);
  };

  const handleUpdateOrganism = async (id: string, organismId: string) => {
    await updateCollection(id, { organismId: organismId || undefined });
    setEditOrg(null);
  };

  const techniqueFilters = useMemo(() => {
    return ['all', ...(techniques ?? []).map(t => t.name)];
  }, [techniques]);

  const ready = newName.trim().length > 0;

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {/* Header */}
      <div className="shrink-0">
        <Heading level="heading">Collections</Heading>
        <Text variant="caption">
          {data ? `${data.length} collection${data.length !== 1 ? 's' : ''}` : 'Loading...'}
        </Text>
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
              {['Name', 'Technique', 'Organism', 'Kind', 'Files', ''].map(h => (
                <th key={h} className="py-1.5 pr-3 pl-2.5 font-body text-micro uppercase tracking-overline text-text-dim font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
              : (
                <>
                  {!filtered.length && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-text-dim font-body text-body">
                        {techFilter !== 'all' ? 'No collections match this technique.' : 'No collections yet.'}
                      </td>
                    </tr>
                  )}
                  {filtered.map(c => (
                    <tr key={c.id} className="border-b border-border-subtle transition-colors duration-fast hover:bg-surface group">
                      <td className="py-1.5 pl-2.5 pr-3">
                        <Link to={`/collections/${c.id}`} className="no-underline">
                          <div className="font-mono text-caption text-text hover:text-accent transition-colors duration-fast">{c.name}</div>
                          {c.description && <div className="text-micro text-text-dim truncate max-w-xs">{c.description}</div>}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3">
                        <InlinePickerCell
                          editing={editTech === c.id}
                          onStartEdit={() => setEditTech(c.id)}
                          picker={
                            <TechniquePicker
                              value={c.techniqueId ?? ''}
                              onValueChange={v => handleUpdateTechnique(c.id, v)}
                              variant="surface"
                              size="sm"
                              className="w-36"
                            />
                          }
                        >
                          {c.techniqueName
                            ? <TechniquePill name={c.techniqueName} />
                            : <span className="text-caption text-text-dim">--</span>
                          }
                        </InlinePickerCell>
                      </td>
                      <td className="py-1.5 pr-3">
                        <InlinePickerCell
                          editing={editOrg === c.id}
                          onStartEdit={() => setEditOrg(c.id)}
                          picker={
                            <OrganismPicker
                              value={c.organismId ?? ''}
                              onValueChange={v => handleUpdateOrganism(c.id, v)}
                              variant="surface"
                              size="sm"
                              className="w-40"
                            />
                          }
                        >
                          <span className="text-caption text-text-secondary italic">
                            {c.organismDisplay ?? '--'}
                          </span>
                        </InlinePickerCell>
                      </td>
                      <td className="py-1.5 pr-3">
                        <Badge variant="count" color="dim">{c.kind}</Badge>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-caption tabular-nums text-text-secondary">
                        {c.fileCount}
                      </td>
                      <td className="py-1.5 pr-3 w-6">
                        <button
                          onClick={() => deleteCollection(c.id)}
                          className="text-text-dim hover:text-red-400 cursor-pointer bg-transparent border-none p-0 text-caption opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
                          title="Delete collection"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}

                  {/* Inline add row */}
                  <tr className="border-b border-border-subtle text-text-dim">
                    <td className="py-1.5 pl-2.5 pr-3">
                      <input
                        ref={nameRef}
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                        placeholder="+ collection name"
                        className="bg-transparent border-b border-transparent outline-none font-mono text-caption text-text placeholder:text-text-dim p-0 w-36 focus:border-accent transition-colors duration-fast"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <TechniquePicker
                        value={newTechId}
                        onValueChange={setNewTechId}
                        variant="surface"
                        size="sm"
                        className="w-28"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <OrganismPicker
                        value={newOrgId}
                        onValueChange={setNewOrgId}
                        variant="surface"
                        size="sm"
                        className="w-32"
                      />
                    </td>
                    <td colSpan={2} />
                    <td className="py-1.5 pr-3 w-6">
                      <span className={`inline-flex items-center gap-1 transition-opacity duration-fast ${ready ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <button
                          disabled={createPending}
                          onClick={handleCreate}
                          className="text-caption text-accent hover:text-text cursor-pointer bg-transparent border-none p-0 font-body"
                          title="Add"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => { setNewName(''); setNewTechId(''); setNewOrgId(''); }}
                          className="text-caption text-text-dim hover:text-text cursor-pointer bg-transparent border-none p-0 font-body"
                          title="Cancel"
                        >
                          ×
                        </button>
                      </span>
                    </td>
                  </tr>
                </>
              )
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
                {techFilter !== 'all' ? 'No collections match this technique.' : 'No collections yet.'}
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

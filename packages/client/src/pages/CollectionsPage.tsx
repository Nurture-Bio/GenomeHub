import { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  useCollectionsQuery, useCreateCollectionMutation,
  useUpdateCollectionMutation, useDeleteCollectionMutation,
  useTechniquesQuery,
} from '../hooks/useGenomicQueries';
import { useConfirmDelete } from '../hooks/useConfirmDelete';
import { techniqueColor, TechniquePill } from '../lib/techniqueColors';
import { Badge, Text, Heading, Card } from '../ui';
import { TechniquePicker, OrganismPicker } from '../ui';

const TH = 'py-1.5 pr-3 pl-2.5 font-body text-micro uppercase tracking-overline text-text-dim font-semibold whitespace-nowrap';

function SkeletonRow() {
  return (
    <tr className="border-b border-border-subtle">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="py-2 pr-3 pl-2.5">
          <div className="skeleton h-4 rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function CollectionsPage() {
  const { data, isLoading, refetch } = useCollectionsQuery();
  const { createCollection, pending: createPending } = useCreateCollectionMutation(refetch);
  const { updateCollection } = useUpdateCollectionMutation(refetch);
  const { deleteCollection } = useDeleteCollectionMutation(refetch);
  const { confirmDelete, dialog } = useConfirmDelete(deleteCollection, 'collection');
  const { data: techniques } = useTechniquesQuery();

  const [techFilter, setTechFilter] = useState<string>('all');

  // Inline add row
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

  const techniqueFilters = useMemo(() => {
    return ['all', ...(techniques ?? []).map(t => t.name)];
  }, [techniques]);

  const ready = newName.trim().length > 0;

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      {dialog}
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
            <button key={t} onClick={() => setTechFilter(t)}
              className="font-body text-micro px-1.5 py-1 md:py-0.5 rounded-sm border transition-colors duration-fast cursor-pointer min-h-5.5 md:min-h-0"
              style={{
                background: techFilter === t ? (colors?.color ?? 'var(--color-accent)') : 'var(--color-surface-2)',
                color: techFilter === t ? 'var(--color-bg)' : 'var(--color-text-secondary)',
                borderColor: techFilter === t ? 'transparent' : 'var(--color-border)',
              }}>
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
              <th className={TH}>Name</th>
              <th className={`${TH} w-36`}>Technique</th>
              <th className={`${TH} w-40`}>Organism</th>
              <th className={TH}>Kind</th>
              <th className={`${TH} text-right`}>Files</th>
              <th className="w-6" />
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
                    <tr key={c.id} className="border-b border-border-subtle hover:bg-surface transition-colors duration-fast group">
                      <td className="py-1.5 pl-2.5 pr-3">
                        <Link to={`/collections/${c.id}`} className="no-underline">
                          <div className="font-mono text-caption text-text hover:text-accent transition-colors duration-fast">{c.name}</div>
                          {c.description && <div className="text-micro text-text-dim truncate max-w-xs">{c.description}</div>}
                        </Link>
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 w-36">
                        <TechniquePicker
                          value={c.techniqueId ?? ''}
                          onValueChange={v => updateCollection(c.id, { techniqueId: v || undefined })}
                          variant="surface" size="sm" className="w-full"
                        />
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 w-40">
                        <OrganismPicker
                          value={c.organismId ?? ''}
                          onValueChange={v => updateCollection(c.id, { organismId: v || undefined })}
                          variant="surface" size="sm" className="w-full"
                        />
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3">
                        <Badge variant="count" color="dim">{c.kind}</Badge>
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 font-mono text-caption tabular-nums text-text-secondary text-right">
                        {c.fileCount}
                      </td>
                      <td className="py-1.5 pr-2.5 w-6">
                        <button onClick={() => confirmDelete(c.id, c.name)}
                          className="text-text-dim hover:text-red-400 cursor-pointer bg-transparent border-none p-0 text-caption opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
                          title="Delete collection">×</button>
                      </td>
                    </tr>
                  ))}

                  {/* Inline add row */}
                  <tr className="text-text-dim">
                    <td className="py-1.5 pl-2.5 pr-3">
                      <input ref={nameRef} value={newName} onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                        placeholder="+ collection name"
                        className="bg-transparent border-b border-transparent outline-none font-mono text-caption text-text placeholder:text-text-dim p-0 w-full focus:border-accent transition-colors duration-fast" />
                    </td>
                    <td className="py-1.5 pl-2.5 pr-3 w-36">
                      <TechniquePicker value={newTechId} onValueChange={setNewTechId} variant="surface" size="sm" className="w-full" />
                    </td>
                    <td className="py-1.5 pl-2.5 pr-3 w-40">
                      <OrganismPicker value={newOrgId} onValueChange={setNewOrgId} variant="surface" size="sm" className="w-full" />
                    </td>
                    <td colSpan={2} />
                    <td className="py-1.5 pr-2.5 w-6">
                      <span className={`inline-flex items-center gap-1 transition-opacity duration-fast ${ready ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <button disabled={createPending} onClick={handleCreate}
                          className="text-caption text-accent hover:text-text cursor-pointer bg-transparent border-none p-0 font-body" title="Add">✓</button>
                        <button onClick={() => { setNewName(''); setNewTechId(''); setNewOrgId(''); }}
                          className="text-caption text-text-dim hover:text-text cursor-pointer bg-transparent border-none p-0 font-body" title="Cancel">×</button>
                      </span>
                    </td>
                  </tr>
                </>
              )}
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
            ? <div className="py-8 text-center text-text-dim text-body font-body">{techFilter !== 'all' ? 'No collections match this technique.' : 'No collections yet.'}</div>
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

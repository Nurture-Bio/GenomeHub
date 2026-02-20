import { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import {
  useCollectionsQuery, useCreateCollectionMutation,
  useUpdateCollectionMutation, useDeleteCollectionMutation,
  useTechniquesQuery,
  useAddCollectionOrganism, useRemoveCollectionOrganism,
  useAddCollectionTechnique, useRemoveCollectionTechnique,
} from '../hooks/useGenomicQueries';
import { useConfirmDelete } from '../hooks/useConfirmDelete';
import { techniqueColor, TechniquePill } from '../lib/techniqueColors';
import { Badge, Text, Heading, Card, ChipEditor, inlineInput, iconAction } from '../ui';
import { TechniquePicker, OrganismPicker, FileTypePicker } from '../ui';

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
  const { addCollectionOrganism } = useAddCollectionOrganism(refetch);
  const { removeCollectionOrganism } = useRemoveCollectionOrganism(refetch);
  const { addCollectionTechnique } = useAddCollectionTechnique(refetch);
  const { removeCollectionTechnique } = useRemoveCollectionTechnique(refetch);

  const [techFilter, setTechFilter] = useState<string>('all');

  // Inline add row
  const [newName, setNewName] = useState('');
  const [newTechId, setNewTechId] = useState('');
  const [newOrgId, setNewOrgId] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (techFilter === 'all') return data;
    return data.filter(c => c.techniques.some(t => t.name === techFilter));
  }, [data, techFilter]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createCollection({
      name: newName.trim(),
      techniqueIds: newTechId ? [newTechId] : undefined,
      organismIds: newOrgId ? [newOrgId] : undefined,
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
          const hc = t === 'all' ? null : techniqueColor(t);
          const active = techFilter === t;
          return (
            <button key={t} onClick={() => setTechFilter(t)}
              className="font-body text-micro px-1.5 py-1 md:py-0.5 rounded-sm border transition-colors duration-fast cursor-pointer min-h-5.5 md:min-h-0"
              style={active && hc
                ? { background: hc.bg, color: hc.color, borderColor: hc.color }
                : { background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }
              }>
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
              <th className="py-1.5 pr-3 pl-2.5"><Text variant="overline">Name</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 w-36"><Text variant="overline">Technique</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 w-40"><Text variant="overline">Organism</Text></th>
              <th className="py-1.5 pr-3 pl-2.5"><Text variant="overline">Type</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 text-right"><Text variant="overline">Files</Text></th>
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
                      <td colSpan={6} className="py-12 text-center">
                        <Text variant="body" className="text-text-dim">
                          {techFilter !== 'all' ? 'No collections match this technique.' : 'No collections yet.'}
                        </Text>
                      </td>
                    </tr>
                  )}
                  {filtered.map(c => (
                    <tr key={c.id} className="border-b border-border-subtle hover:bg-surface transition-colors duration-fast group">
                      <td className="py-1.5 pl-2.5 pr-3">
                        <Link to={`/collections/${c.id}`} className="no-underline">
                          <Text variant="mono" className="hover:text-accent transition-colors duration-fast">{c.name}</Text>
                          {c.description && <Text variant="caption" className="truncate max-w-xs block">{c.description}</Text>}
                        </Link>
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 w-36">
                        <ChipEditor
                          colored
                          items={c.techniques.map(t => ({ id: t.id, label: t.name }))}
                          onAdd={id => addCollectionTechnique(c.id, id)}
                          onRemove={id => removeCollectionTechnique(c.id, id)}
                          renderPicker={p => <TechniquePicker {...p} variant="surface" size="sm" className="w-32" />}
                          maxVisible={2}
                        />
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 w-40">
                        <ChipEditor
                          colored
                          items={c.organisms.map(o => ({ id: o.id, label: o.displayName }))}
                          onAdd={id => addCollectionOrganism(c.id, id)}
                          onRemove={id => removeCollectionOrganism(c.id, id)}
                          renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-36" />}
                          maxVisible={2}
                        />
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 w-32">
                        <ChipEditor
                          colored
                          items={c.types.map(t => ({ id: t, label: t }))}
                          onAdd={id => updateCollection(c.id, { types: [...c.types, id] })}
                          onRemove={id => updateCollection(c.id, { types: c.types.filter(t => t !== id) })}
                          renderPicker={p => <FileTypePicker {...p} variant="surface" size="sm" className="w-28" />}
                          maxVisible={2}
                        />
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 text-right">
                        <Text variant="mono" className="text-text-secondary">{c.fileCount}</Text>
                      </td>
                      <td className="py-1.5 pr-2.5 w-6">
                        <button onClick={() => confirmDelete(c.id, c.name)}
                          className={iconAction({ color: 'danger', reveal: true })}
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
                        className={cx(inlineInput({ font: 'mono' }), 'w-full')} />
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
                          className={iconAction({ color: 'accent' })} title="Add">✓</button>
                        <button onClick={() => { setNewName(''); setNewTechId(''); setNewOrgId(''); }}
                          className={iconAction({ color: 'dim' })} title="Cancel">×</button>
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
            ? <Text variant="body" className="py-8 text-center text-text-dim">{techFilter !== 'all' ? 'No collections match this technique.' : 'No collections yet.'}</Text>
            : filtered.map(c => (
              <Link key={c.id} to={`/collections/${c.id}`} className="no-underline">
                <Card className="p-2.5 flex flex-col gap-1 hover:border-accent transition-colors duration-fast cursor-pointer">
                  <div className="flex items-center gap-2">
                    {c.techniques.map(t => <TechniquePill key={t.id} name={t.name} />)}
                    <Text variant="mono" className="truncate flex-1 min-w-0">{c.name}</Text>
                    {c.types.map(t => <Badge key={t} variant="count" color="dim">{t}</Badge>)}
                  </div>
                  {c.description && <Text variant="caption" className="truncate">{c.description}</Text>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.organisms.map(o => <Text key={o.id} variant="caption" className="italic">{o.displayName}</Text>)}
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

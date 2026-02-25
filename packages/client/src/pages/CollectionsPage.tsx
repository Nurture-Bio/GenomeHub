import { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { cx } from 'class-variance-authority';
import { Gigbag } from 'concertina';
import {
  useCollectionsQuery, useCreateCollectionMutation,
  useUpdateCollectionMutation, useDeleteCollectionMutation,
  useTechniquesQuery, useOrganismsQuery,
  useAddCollectionOrganism, useRemoveCollectionOrganism,
  useAddCollectionTechnique, useRemoveCollectionTechnique,
} from '../hooks/useGenomicQueries';
import { useConfirmDelete } from '../hooks/useConfirmDelete';
import { Badge, Text, Heading, Card, ChipEditor, HashPill, FilterChip, inlineInput, iconAction } from '../ui';
import { TechniquePicker, OrganismPicker, FileTypePicker } from '../ui';

function SkeletonRow() {
  return (
    <tr className="border-b border-line">
      <td className="py-1.5 pl-2.5 pr-3">
        <div className="flex flex-col gap-1">
          <div className="concertina-warmup-line concertina-warmup-line-long" />
          <div className="concertina-warmup-line concertina-warmup-line-short" />
        </div>
      </td>
      <td className="py-1.5 pl-2.5 pr-3">
        <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
      </td>
      <td className="py-1.5 pl-2.5 pr-3">
        <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
      </td>
      <td className="py-1.5 pl-2.5 pr-3">
        <div className="concertina-warmup-line concertina-warmup-line-short rounded-full" />
      </td>
      <td className="py-1.5 pl-2.5 pr-3 text-right">
        <div className="concertina-warmup-line concertina-warmup-line-short ml-auto" />
      </td>
      <td />
    </tr>
  );
}

export default function CollectionsPage() {
  const { data, isLoading } = useCollectionsQuery();
  const { createCollection, pending: createPending } = useCreateCollectionMutation();
  const { updateCollection } = useUpdateCollectionMutation();
  const { deleteCollection } = useDeleteCollectionMutation();
  const { confirmDelete } = useConfirmDelete(deleteCollection, 'collection');
  const { data: techniques } = useTechniquesQuery();
  const { data: organisms }  = useOrganismsQuery();
  const { addCollectionOrganism } = useAddCollectionOrganism();
  const { removeCollectionOrganism } = useRemoveCollectionOrganism();
  const { addCollectionTechnique } = useAddCollectionTechnique();
  const { removeCollectionTechnique } = useRemoveCollectionTechnique();

  const [techFilter, setTechFilter] = useState('');
  const [orgFilter,  setOrgFilter]  = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Inline add row
  const [newName, setNewName] = useState('');
  const [newTechId, setNewTechId] = useState('');
  const [newOrgId, setNewOrgId] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter(c => {
      const matchTech = !techFilter || c.techniques.some(t => t.name === techFilter);
      const matchOrg  = !orgFilter  || c.organisms.some(o => o.id === orgFilter);
      const matchType = !typeFilter || c.types.includes(typeFilter);
      return matchTech && matchOrg && matchType;
    });
  }, [data, techFilter, orgFilter, typeFilter]);

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

  const techniqueItems = useMemo(() => {
    return (techniques ?? []).map(t => ({ id: t.name, label: t.name }));
  }, [techniques]);

  const orgItems = useMemo(() => {
    if (!data) return [];
    const orgs = new Map<string, string>();
    data.forEach(c => c.organisms.forEach(o => orgs.set(o.id, o.displayName)));
    return Array.from(orgs.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => ({ id, label }));
  }, [data]);

  const typeItems = useMemo(() => {
    if (!data) return [];
    const types = new Set(data.flatMap(c => c.types).filter(Boolean));
    return Array.from(types).sort().map(t => ({ id: t, label: t }));
  }, [data]);

  const ready = newName.trim().length > 0;

  // Items for ChipEditor in the add row (look up labels from query data)
  const newTechItems = useMemo(() => {
    if (!newTechId || !techniques) return [];
    const t = techniques.find(t => t.id === newTechId);
    return t ? [{ id: t.id, label: t.name }] : [];
  }, [newTechId, techniques]);

  const newOrgItems = useMemo(() => {
    if (!newOrgId || !organisms) return [];
    const o = organisms.find(o => o.id === newOrgId);
    return o ? [{ id: o.id, label: o.displayName }] : [];
  }, [newOrgId, organisms]);

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3 h-full min-h-0">
      <div className="shrink-0">
        <Heading level="heading">Collections</Heading>
        <Text variant="dim">
          {data ? `${data.length} collection${data.length !== 1 ? 's' : ''}` : 'Loading...'}
        </Text>
      </div>

      <div className="flex gap-1 flex-wrap shrink-0">
        <FilterChip label="All techniques" items={techniqueItems} value={techFilter} onValueChange={setTechFilter} />
        <FilterChip label="All organisms" items={orgItems} value={orgFilter} onValueChange={setOrgFilter} />
        <FilterChip label="All types" items={typeItems} value={typeFilter} onValueChange={setTypeFilter} />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block flex-1 overflow-auto min-h-0 border border-line rounded-md bg-base" style={{ scrollbarGutter: 'stable' }}>
        <Gigbag className="w-full">
        <table className="w-full border-collapse text-left table-fixed">
          <thead className="sticky top-0 bg-raised z-10">
            <tr className="border-b border-line">
              <th className="py-1.5 pr-3 pl-2.5"><Text variant="muted">Name</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 w-36"><Text variant="muted">Technique</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 w-40"><Text variant="muted">Organism</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 w-32"><Text variant="muted">Type</Text></th>
              <th className="py-1.5 pr-3 pl-2.5 w-16 text-right"><Text variant="muted">Files</Text></th>
              <th className="w-8" />
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
                        <Text variant="body" className="text-fg-3">
                          {techFilter || orgFilter || typeFilter ? 'No collections match your filters.' : 'No collections yet.'}
                        </Text>
                      </td>
                    </tr>
                  )}
                  {filtered.map(c => (
                    <tr key={c.id} className="border-b border-line hover:bg-base transition-colors duration-fast group">
                      <td className="py-1.5 pl-2.5 pr-3">
                        <Link to={`/collections/${c.id}`} className="no-underline">
                          <Text variant="body" className="hover:text-cyan transition-colors duration-fast">{c.name}</Text>
                          {c.description && <Text variant="dim" className="truncate max-w-xs block">{c.description}</Text>}
                        </Link>
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                        <ChipEditor
                          items={c.techniques.map(t => ({ id: t.id, label: t.name }))}
                          onAdd={id => addCollectionTechnique(c.id, id)}
                          onRemove={id => removeCollectionTechnique(c.id, id)}
                          renderPicker={p => <TechniquePicker {...p} variant="surface" size="sm" className="w-32" />}
                          maxVisible={2}
                        />
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                        <ChipEditor
                          items={c.organisms.map(o => ({ id: o.id, label: o.displayName }))}
                          onAdd={id => addCollectionOrganism(c.id, id)}
                          onRemove={id => removeCollectionOrganism(c.id, id)}
                          renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-36" />}
                          maxVisible={2}
                        />
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                        <ChipEditor
                          items={c.types.map(t => ({ id: t, label: t }))}
                          onAdd={id => updateCollection(c.id, { types: [...c.types, id] })}
                          onRemove={id => updateCollection(c.id, { types: c.types.filter(t => t !== id) })}
                          renderPicker={p => <FileTypePicker {...p} variant="surface" size="sm" className="w-28" />}
                          maxVisible={2}
                        />
                      </td>
                      <td className="py-1.5 pl-2.5 pr-3 text-right">
                        <Text variant="dim" className="tabular-nums">{c.fileCount}</Text>
                      </td>
                      <td className="py-1.5 pr-2.5 w-6">
                        <button onClick={() => confirmDelete(c.id, c.name)}
                          className={iconAction({ color: 'danger', reveal: true })}
                          title="Delete collection">×</button>
                      </td>
                    </tr>
                  ))}

                  {/* Inline add row */}
                  <tr className="text-fg-3">
                    <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                      <input ref={nameRef} value={newName} onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                        placeholder="+ collection name"
                        className={cx(inlineInput({ font: 'body' }), 'w-full')} />
                    </td>
                    <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                      <ChipEditor
                        items={newTechItems}
                        onAdd={setNewTechId}
                        onRemove={() => setNewTechId('')}
                        renderPicker={p => <TechniquePicker {...p} variant="surface" size="sm" className="w-32" />}
                        maxVisible={1}
                      />
                    </td>
                    <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
                      <ChipEditor
                        items={newOrgItems}
                        onAdd={setNewOrgId}
                        onRemove={() => setNewOrgId('')}
                        renderPicker={p => <OrganismPicker {...p} variant="surface" size="sm" className="w-36" />}
                        maxVisible={1}
                      />
                    </td>
                    <td colSpan={2} />
                    <td className="py-1.5 pr-2.5">
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
        </Gigbag>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-1.5 md:hidden flex-1 overflow-auto min-h-0">
        {isLoading
          ? [...Array(4)].map((_, i) => (
            <Card key={i} className="p-2.5 flex flex-col gap-1">
              <div className="concertina-warmup-line concertina-warmup-line-long" />
              <div className="concertina-warmup-line concertina-warmup-line-short" />
            </Card>
          ))
          : !filtered.length
            ? <Text variant="body" className="py-8 text-center text-fg-3">{techFilter || orgFilter || typeFilter ? 'No collections match your filters.' : 'No collections yet.'}</Text>
            : filtered.map(c => (
              <Link key={c.id} to={`/collections/${c.id}`} className="no-underline">
                <Card className="p-2.5 flex flex-col gap-1 hover:border-cyan transition-colors duration-fast cursor-pointer">
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.techniques.map(t => <HashPill key={t.id} label={t.name} />)}
                    <Text variant="body" className="truncate flex-1 min-w-0">{c.name}</Text>
                    {c.types.map(t => <HashPill key={t} label={t} />)}
                  </div>
                  {c.description && <Text variant="dim" className="truncate">{c.description}</Text>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.organisms.map(o => <HashPill key={o.id} label={o.displayName} />)}
                    <Text variant="dim">{c.fileCount} files</Text>
                  </div>
                </Card>
              </Link>
            ))
        }
      </div>
    </div>
  );
}

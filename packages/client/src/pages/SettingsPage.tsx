import { useState, useCallback, useRef } from 'react';
import { cx } from 'class-variance-authority';
import {
  useTechniquesQuery, useCreateTechniqueMutation,
  useRelationTypesQuery, useCreateRelationTypeMutation,
  useFileTypesQuery, useCreateFileTypeMutation,
} from '../hooks/useGenomicQueries';
import { useConfirmDelete } from '../hooks/useConfirmDelete';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { Heading, Text, InlineInput, inlineInput, iconAction } from '../ui';

// ── Editable row (table row) ────────────────────────────

interface EditableRowProps {
  id: string;
  name: string;
  description: string | null;
  onSave: (id: string, patch: { name?: string; description?: string }) => Promise<void>;
  onDelete: (id: string, name: string) => void;
}

function EditableRow({ id, name, description, onSave, onDelete }: EditableRowProps) {
  return (
    <tr className="border-b border-border-subtle group hover:bg-surface transition-colors duration-fast">
      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
        <InlineInput value={name} mono fullWidth className="font-semibold" onCommit={val => onSave(id, { name: val })} />
      </td>
      <td className="py-1.5 pr-3 overflow-hidden">
        <InlineInput value={description ?? ''} placeholder="add description" fullWidth onCommit={val => onSave(id, { description: val })} />
      </td>
      <td className="py-1.5 pr-2.5 w-8">
        <button onClick={() => onDelete(id, name)}
          className={iconAction({ color: 'danger', reveal: true })} title="Delete">×</button>
      </td>
    </tr>
  );
}

// ── Add row (table row) ─────────────────────────────────

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const commit = async () => {
    if (!name.trim()) return;
    setPending(true);
    try {
      await onAdd(name.trim(), desc.trim());
      setName(''); setDesc('');
      nameRef.current?.focus();
    } finally { setPending(false); }
  };

  const hasInput = name.trim().length > 0;

  return (
    <tr className="text-text-dim">
      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder={placeholder}
          className={cx(inlineInput({ font: 'mono' }), 'font-semibold w-full')} />
      </td>
      <td className="py-1.5 pr-3 overflow-hidden">
        <input value={desc} onChange={e => setDesc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder="description"
          className={cx(inlineInput({ font: 'body' }), 'w-full')} />
      </td>
      <td className="py-1.5 pr-2.5 w-8">
        <span className={`inline-flex items-center gap-1 transition-opacity duration-fast ${hasInput ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <button disabled={pending} onClick={commit}
            className={iconAction({ color: 'accent' })} title="Add">✓</button>
          <button onClick={() => { setName(''); setDesc(''); }}
            className={iconAction({ color: 'dim' })} title="Cancel">×</button>
        </span>
      </td>
    </tr>
  );
}

// ── Section table wrapper ───────────────────────────────

function SectionTable({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <Heading level="subheading">{title}</Heading>
        <Text variant="caption">{subtitle}</Text>
      </div>
      <div className="border border-border rounded-md bg-surface overflow-hidden">
        <table className="w-full border-collapse text-left table-fixed">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="py-1.5 pr-3 pl-2.5 w-44"><Text variant="overline">Name</Text></th>
              <th className="py-1.5 pr-3 pl-2.5"><Text variant="overline">Description</Text></th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── Settings page ────────────────────────────────────────

export default function SettingsPage() {
  const { data: relationTypes, refetch: refetchRelations } = useRelationTypesQuery();
  const { createRelationType } = useCreateRelationTypeMutation(refetchRelations);

  const saveRelation = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    const r = await apiFetch(`/api/relation-types/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error('Update failed');
    toast.success('Updated'); refetchRelations();
  }, [refetchRelations]);

  const doDeleteRelation = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/relation-types/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('Deleted'); refetchRelations();
  }, [refetchRelations]);
  const { confirmDelete: confirmDeleteRelation } = useConfirmDelete(doDeleteRelation, 'relation type');

  const addRelation = useCallback(async (name: string, description: string) => {
    await createRelationType({ name, description: description || undefined });
  }, [createRelationType]);

  const { data: fileTypes, refetch: refetchTypes } = useFileTypesQuery();
  const { createFileType } = useCreateFileTypeMutation(refetchTypes);

  const saveType = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    const r = await apiFetch(`/api/file-types/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error('Update failed');
    toast.success('Updated'); refetchTypes();
  }, [refetchTypes]);

  const doDeleteType = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/file-types/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('Deleted'); refetchTypes();
  }, [refetchTypes]);
  const { confirmDelete: confirmDeleteType } = useConfirmDelete(doDeleteType, 'file type');

  const addType = useCallback(async (name: string, description: string) => {
    await createFileType({ name, description: description || undefined });
  }, [createFileType]);

  const { data: techniques, refetch: refetchTechniques } = useTechniquesQuery();
  const { createTechnique } = useCreateTechniqueMutation(refetchTechniques);

  const saveTechnique = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    const r = await apiFetch(`/api/techniques/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error('Update failed');
    toast.success('Updated'); refetchTechniques();
  }, [refetchTechniques]);

  const doDeleteTechnique = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/techniques/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('Deleted'); refetchTechniques();
  }, [refetchTechniques]);
  const { confirmDelete: confirmDeleteTechnique } = useConfirmDelete(doDeleteTechnique, 'technique');

  const addTechnique = useCallback(async (name: string, description: string) => {
    await createTechnique({ name, description: description || undefined });
  }, [createTechnique]);

  return (
    <div className="flex flex-col gap-4 md:gap-5 p-2 md:p-3 max-w-2xl mx-auto w-full">
      <div>
        <Heading level="heading">Settings</Heading>
        <Text variant="caption">Manage reference data used across GenomeHub</Text>
      </div>

      <SectionTable title="Relation Types" subtitle="Define how files can be linked to each other">
        {(relationTypes ?? []).map(rt => (
          <EditableRow key={rt.id} id={rt.id} name={rt.name} description={rt.description} onSave={saveRelation} onDelete={confirmDeleteRelation} />
        ))}
        <AddRow placeholder="+ new relation type" onAdd={addRelation} />
      </SectionTable>

      <SectionTable title="File Types" subtitle="Classify files by their biological meaning">
        {(fileTypes ?? []).map(ft => (
          <EditableRow key={ft.id} id={ft.id} name={ft.name} description={ft.description} onSave={saveType} onDelete={confirmDeleteType} />
        ))}
        <AddRow placeholder="+ new file type" onAdd={addType} />
      </SectionTable>

      <SectionTable title="Techniques" subtitle="Sequencing techniques linked to collections">
        {(techniques ?? []).map(t => (
          <EditableRow key={t.id} id={t.id} name={t.name} description={t.description}
            onSave={saveTechnique} onDelete={confirmDeleteTechnique} />
        ))}
        <AddRow placeholder="+ new technique" onAdd={addTechnique} />
      </SectionTable>
    </div>
  );
}

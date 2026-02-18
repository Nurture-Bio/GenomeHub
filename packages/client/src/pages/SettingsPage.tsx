import { useState, useCallback, useRef } from 'react';
import {
  useTechniquesQuery, useCreateTechniqueMutation,
  useRelationTypesQuery, useCreateRelationTypeMutation,
  useFileKindsQuery, useCreateFileKindMutation,
} from '../hooks/useGenomicQueries';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { Heading, Text, InlineInput } from '../ui';

// ── Table header ─────────────────────────────────────────

const TH = 'py-1.5 pr-3 pl-2.5 font-body text-micro uppercase tracking-overline text-text-dim font-semibold whitespace-nowrap';

// ── Editable row (table row) ────────────────────────────

interface EditableRowProps {
  id: string;
  name: string;
  description: string | null;
  onSave: (id: string, patch: { name?: string; description?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function EditableRow({ id, name, description, onSave, onDelete }: EditableRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);

  const handleDelete = async () => {
    setPending(true);
    try { await onDelete(id); } finally { setPending(false); setConfirmDelete(false); }
  };

  return (
    <tr className="border-b border-border-subtle group hover:bg-surface transition-colors duration-fast">
      <td className="py-1.5 pl-2.5 pr-3">
        <InlineInput value={name} mono fullWidth className="font-semibold" onCommit={val => onSave(id, { name: val })} />
      </td>
      <td className="py-1.5 pr-3">
        <InlineInput value={description ?? ''} placeholder="add description" fullWidth onCommit={val => onSave(id, { description: val })} />
      </td>
      <td className="py-1.5 pr-2.5 w-8">
        {confirmDelete ? (
          <span className="inline-flex items-center gap-1">
            <button disabled={pending} onClick={handleDelete}
              className="text-caption text-red-400 hover:text-red-300 cursor-pointer bg-transparent border-none p-0 font-body" title="Confirm">✓</button>
            <button onClick={() => setConfirmDelete(false)}
              className="text-caption text-text-dim hover:text-text cursor-pointer bg-transparent border-none p-0 font-body" title="Cancel">×</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)}
            className="text-caption text-text-dim hover:text-red-400 cursor-pointer bg-transparent border-none p-0 font-body opacity-0 group-hover:opacity-100 transition-opacity duration-fast" title="Delete">×</button>
        )}
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
      <td className="py-1.5 pl-2.5 pr-3">
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder={placeholder}
          className="bg-transparent border-b border-transparent outline-none font-mono text-caption font-semibold text-text placeholder:text-text-dim p-0 w-full focus:border-accent transition-colors duration-fast" />
      </td>
      <td className="py-1.5 pr-3">
        <input value={desc} onChange={e => setDesc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder="description"
          className="bg-transparent border-b border-transparent outline-none text-caption text-text-dim placeholder:text-text-dim p-0 w-full focus:border-accent transition-colors duration-fast" />
      </td>
      <td className="py-1.5 pr-2.5 w-8">
        <span className={`inline-flex items-center gap-1 transition-opacity duration-fast ${hasInput ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <button disabled={pending} onClick={commit}
            className="text-caption text-accent hover:text-text cursor-pointer bg-transparent border-none p-0 font-body" title="Add">✓</button>
          <button onClick={() => { setName(''); setDesc(''); }}
            className="text-caption text-text-dim hover:text-text cursor-pointer bg-transparent border-none p-0 font-body" title="Cancel">×</button>
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
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className={`${TH} w-48`}>Name</th>
              <th className={TH}>Description</th>
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

  const deleteRelation = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/relation-types/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('Deleted'); refetchRelations();
  }, [refetchRelations]);

  const addRelation = useCallback(async (name: string, description: string) => {
    await createRelationType({ name, description: description || undefined });
  }, [createRelationType]);

  const { data: fileKinds, refetch: refetchKinds } = useFileKindsQuery();
  const { createFileKind } = useCreateFileKindMutation(refetchKinds);

  const saveKind = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    const r = await apiFetch(`/api/file-kinds/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error('Update failed');
    toast.success('Updated'); refetchKinds();
  }, [refetchKinds]);

  const deleteKind = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/file-kinds/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('Deleted'); refetchKinds();
  }, [refetchKinds]);

  const addKind = useCallback(async (name: string, description: string) => {
    await createFileKind({ name, description: description || undefined });
  }, [createFileKind]);

  const { data: techniques, refetch: refetchTechniques } = useTechniquesQuery();
  const { createTechnique } = useCreateTechniqueMutation(refetchTechniques);

  const saveTechnique = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    const r = await apiFetch(`/api/techniques/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error('Update failed');
    toast.success('Updated'); refetchTechniques();
  }, [refetchTechniques]);

  const deleteTechnique = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/techniques/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('Deleted'); refetchTechniques();
  }, [refetchTechniques]);

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
          <EditableRow key={rt.id} id={rt.id} name={rt.name} description={rt.description} onSave={saveRelation} onDelete={deleteRelation} />
        ))}
        <AddRow placeholder="+ new relation type" onAdd={addRelation} />
      </SectionTable>

      <SectionTable title="File Kinds" subtitle="Classify files by their biological meaning">
        {(fileKinds ?? []).map(fk => (
          <EditableRow key={fk.id} id={fk.id} name={fk.name} description={fk.description} onSave={saveKind} onDelete={deleteKind} />
        ))}
        <AddRow placeholder="+ new file kind" onAdd={addKind} />
      </SectionTable>

      <SectionTable title="Techniques" subtitle="Sequencing techniques linked to collections">
        {(techniques ?? []).map(t => (
          <EditableRow key={t.id} id={t.id} name={t.name} description={t.description}
            onSave={saveTechnique} onDelete={deleteTechnique} />
        ))}
        <AddRow placeholder="+ new technique" onAdd={addTechnique} />
      </SectionTable>
    </div>
  );
}

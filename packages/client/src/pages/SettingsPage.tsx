import { useState, useCallback } from 'react';
import {
  useTechniquesQuery, useCreateTechniqueMutation,
  useRelationTypesQuery, useCreateRelationTypeMutation,
  useFileKindsQuery, useCreateFileKindMutation,
} from '../hooks/useGenomicQueries';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { Heading, Text, Button, Input, Card } from '../ui';

// ── Editable row ─────────────────────────────────────────

interface EditableRowProps {
  id: string;
  name: string;
  description: string | null;
  extra?: string;
  onSave: (id: string, patch: { name: string; description: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function EditableRow({ id, name, description, extra, onSave, onDelete }: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description ?? '');
  const [pending, setPending] = useState(false);

  const handleSave = async () => {
    setPending(true);
    try {
      await onSave(id, { name: editName, description: editDesc });
      setEditing(false);
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async () => {
    setPending(true);
    try {
      await onDelete(id);
    } finally {
      setPending(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 p-2 bg-surface border border-border rounded-sm">
        <Input
          variant="surface" size="sm"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          placeholder="Name"
          className="w-40"
        />
        <Input
          variant="surface" size="sm"
          value={editDesc}
          onChange={e => setEditDesc(e.target.value)}
          placeholder="Description"
          className="flex-1"
        />
        <Button intent="primary" size="sm" pending={pending} onClick={handleSave}>Save</Button>
        <Button intent="ghost" size="sm" onClick={() => { setEditing(false); setEditName(name); setEditDesc(description ?? ''); }}>Cancel</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-surface border border-border rounded-sm group">
      <span className="font-mono text-caption text-text font-semibold">{name}</span>
      {extra && <span className="font-mono text-micro text-text-dim">{extra}</span>}
      <span className="text-caption text-text-dim flex-1 truncate">{description ?? ''}</span>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-fast">
        <Button intent="ghost" size="xs" onClick={() => setEditing(true)}>Edit</Button>
        <Button intent="danger" size="xs" pending={pending} onClick={handleDelete}>Delete</Button>
      </div>
    </div>
  );
}

// ── Add form ─────────────────────────────────────────────

interface AddFormProps {
  namePlaceholder: string;
  onAdd: (name: string, description: string) => Promise<void>;
}

function AddForm({ namePlaceholder, onAdd }: AddFormProps) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [pending, setPending] = useState(false);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setPending(true);
    try {
      await onAdd(name.trim(), desc.trim());
      setName('');
      setDesc('');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        variant="surface" size="sm"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={namePlaceholder}
        className="w-40"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <Input
        variant="surface" size="sm"
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="Description"
        className="flex-1"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <Button intent="primary" size="sm" pending={pending} onClick={handleAdd} disabled={!name.trim()}>
        Add
      </Button>
    </div>
  );
}

// ── Settings page ────────────────────────────────────────

export default function SettingsPage() {
  // Relation types
  const { data: relationTypes, refetch: refetchRelations } = useRelationTypesQuery();
  const { createRelationType } = useCreateRelationTypeMutation(refetchRelations);

  const saveRelation = useCallback(async (id: string, patch: { name: string; description: string }) => {
    const r = await apiFetch(`/api/relation-types/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error('Update failed');
    toast.success('Relation type updated');
    refetchRelations();
  }, [refetchRelations]);

  const deleteRelation = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/relation-types/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('Relation type deleted');
    refetchRelations();
  }, [refetchRelations]);

  const addRelation = useCallback(async (name: string, description: string) => {
    await createRelationType({ name, description: description || undefined });
  }, [createRelationType]);

  // File kinds
  const { data: fileKinds, refetch: refetchKinds } = useFileKindsQuery();
  const { createFileKind } = useCreateFileKindMutation(refetchKinds);

  const saveKind = useCallback(async (id: string, patch: { name: string; description: string }) => {
    const r = await apiFetch(`/api/file-kinds/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error('Update failed');
    toast.success('File kind updated');
    refetchKinds();
  }, [refetchKinds]);

  const deleteKind = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/file-kinds/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('File kind deleted');
    refetchKinds();
  }, [refetchKinds]);

  const addKind = useCallback(async (name: string, description: string) => {
    await createFileKind({ name, description: description || undefined });
  }, [createFileKind]);

  // Techniques
  const { data: techniques, refetch: refetchTechniques } = useTechniquesQuery();
  const { createTechnique } = useCreateTechniqueMutation(refetchTechniques);

  const saveTechnique = useCallback(async (id: string, patch: { name: string; description: string }) => {
    const r = await apiFetch(`/api/techniques/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error('Update failed');
    toast.success('Technique updated');
    refetchTechniques();
  }, [refetchTechniques]);

  const deleteTechnique = useCallback(async (id: string) => {
    const r = await apiFetch(`/api/techniques/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    toast.success('Technique deleted');
    refetchTechniques();
  }, [refetchTechniques]);

  const addTechnique = useCallback(async (name: string, description: string) => {
    await createTechnique({ name, description: description || undefined });
  }, [createTechnique]);

  return (
    <div className="flex flex-col gap-3 md:gap-4 p-2 md:p-3 max-w-2xl mx-auto w-full">
      <div>
        <Heading level="heading">Settings</Heading>
        <Text variant="caption">Manage reference data used across GenomeHub</Text>
      </div>

      {/* Relation types */}
      <div className="flex flex-col gap-1.5">
        <div>
          <Heading level="subheading">Relation Types</Heading>
          <Text variant="caption">Define how files can be linked to each other</Text>
        </div>
        {(relationTypes ?? []).map(rt => (
          <EditableRow
            key={rt.id}
            id={rt.id}
            name={rt.name}
            description={rt.description}
            onSave={saveRelation}
            onDelete={deleteRelation}
          />
        ))}
        <AddForm namePlaceholder="e.g. aligned_from" onAdd={addRelation} />
      </div>

      {/* File kinds */}
      <div className="flex flex-col gap-1.5">
        <div>
          <Heading level="subheading">File Kinds</Heading>
          <Text variant="caption">Classify files by their biological meaning</Text>
        </div>
        {(fileKinds ?? []).map(fk => (
          <EditableRow
            key={fk.id}
            id={fk.id}
            name={fk.name}
            description={fk.description}
            onSave={saveKind}
            onDelete={deleteKind}
          />
        ))}
        <AddForm namePlaceholder="e.g. config" onAdd={addKind} />
      </div>

      {/* Techniques */}
      <div className="flex flex-col gap-1.5">
        <div>
          <Heading level="subheading">Techniques</Heading>
          <Text variant="caption">Sequencing techniques linked to collections</Text>
        </div>
        {(techniques ?? []).map(t => (
          <EditableRow
            key={t.id}
            id={t.id}
            name={t.name}
            description={t.description}
            extra={t.defaultTags?.length ? `tags: ${t.defaultTags.join(', ')}` : undefined}
            onSave={saveTechnique}
            onDelete={deleteTechnique}
          />
        ))}
        <AddForm namePlaceholder="e.g. CLIP-seq" onAdd={addTechnique} />
      </div>
    </div>
  );
}

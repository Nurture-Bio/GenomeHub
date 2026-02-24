import { useState, useCallback, useRef } from 'react';
import { cx } from 'class-variance-authority';
import {
  useTechniquesQuery, useCreateTechniqueMutation,
  useUpdateTechniqueMutation, useDeleteTechniqueMutation,
  useRelationTypesQuery, useCreateRelationTypeMutation,
  useUpdateRelationTypeMutation, useDeleteRelationTypeMutation,
  useFileTypesQuery, useCreateFileTypeMutation,
  useUpdateFileTypeMutation, useDeleteFileTypeMutation,
  useEnginesQuery, useCreateEngineMutation,
  useUpdateEngineMutation, useDeleteEngineMutation,
} from '../hooks/useGenomicQueries';
import { useConfirmDelete } from '../hooks/useConfirmDelete';
import { Heading, Text, InlineInput, inlineInput, iconAction } from '../ui';
import { statusDot } from '../ui/recipes';

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
    <tr className="border-b border-line group hover:bg-base transition-colors duration-fast">
      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
        <InlineInput value={name} fullWidth className="font-semibold" onCommit={val => onSave(id, { name: val })} />
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
    <tr className="text-fg-3">
      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder={placeholder}
          className={cx(inlineInput({ font: 'body' }), 'font-semibold w-full')} />
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
        <Text variant="dim">{subtitle}</Text>
      </div>
      <div className="border border-line rounded-md bg-base overflow-hidden">
        <table className="w-full border-collapse text-left table-fixed">
          <thead>
            <tr className="border-b border-line bg-raised">
              <th className="py-1.5 pr-3 pl-2.5 w-44"><Text variant="muted">Name</Text></th>
              <th className="py-1.5 pr-3 pl-2.5"><Text variant="muted">Description</Text></th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── Engine row ───────────────────────────────────────────

interface EngineRowProps {
  id: string;
  name: string;
  url: string;
  status: 'ok' | 'error' | 'unavailable';
  onSave: (id: string, patch: { name?: string; url?: string }) => Promise<void>;
  onDelete: (id: string, name: string) => void;
}

function EngineRow({ id, name, url, status, onSave, onDelete }: EngineRowProps) {
  return (
    <tr className="border-b border-line group hover:bg-base transition-colors duration-fast">
      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
        <div className="flex items-center gap-1.5">
          <div className={statusDot({ status: status === 'ok' ? 'connected' : 'disconnected', size: 'sm' })} />
          <InlineInput value={name} fullWidth className="font-semibold" onCommit={val => onSave(id, { name: val })} />
        </div>
      </td>
      <td className="py-1.5 pr-3 overflow-hidden">
        <InlineInput value={url} fullWidth onCommit={val => onSave(id, { url: val })} />
      </td>
      <td className="py-1.5 pr-2.5 w-8">
        <button onClick={() => onDelete(id, name)}
          className={iconAction({ color: 'danger', reveal: true })} title="Delete">×</button>
      </td>
    </tr>
  );
}

function EngineAddRow({ onAdd }: { onAdd: (name: string, url: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const commit = async () => {
    if (!name.trim() || !url.trim()) return;
    setPending(true);
    try {
      await onAdd(name.trim(), url.trim());
      setName(''); setUrl('');
      nameRef.current?.focus();
    } finally { setPending(false); }
  };

  const hasInput = name.trim().length > 0 && url.trim().length > 0;

  return (
    <tr className="text-fg-3">
      <td className="py-1.5 pl-2.5 pr-3 overflow-hidden">
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder="+ new engine"
          className={cx(inlineInput({ font: 'body' }), 'font-semibold w-full')} />
      </td>
      <td className="py-1.5 pr-3 overflow-hidden">
        <input value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder="http://localhost:8001"
          className={cx(inlineInput({ font: 'body' }), 'w-full')} />
      </td>
      <td className="py-1.5 pr-2.5 w-8">
        <span className={`inline-flex items-center gap-1 transition-opacity duration-fast ${hasInput ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <button disabled={pending} onClick={commit}
            className={iconAction({ color: 'accent' })} title="Add">✓</button>
          <button onClick={() => { setName(''); setUrl(''); }}
            className={iconAction({ color: 'dim' })} title="Cancel">×</button>
        </span>
      </td>
    </tr>
  );
}

function EngineTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <Heading level="subheading">Engines</Heading>
        <Text variant="dim">External analysis services. Must respond to GET /api/health.</Text>
      </div>
      <div className="border border-line rounded-md bg-base overflow-hidden">
        <table className="w-full border-collapse text-left table-fixed">
          <thead>
            <tr className="border-b border-line bg-raised">
              <th className="py-1.5 pr-3 pl-2.5 w-44"><Text variant="muted">Name</Text></th>
              <th className="py-1.5 pr-3 pl-2.5"><Text variant="muted">URL</Text></th>
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
  // Relation types
  const { data: relationTypes } = useRelationTypesQuery();
  const { createRelationType } = useCreateRelationTypeMutation();
  const { updateRelationType } = useUpdateRelationTypeMutation();
  const { deleteRelationType } = useDeleteRelationTypeMutation();
  const { confirmDelete: confirmDeleteRelation } = useConfirmDelete(deleteRelationType, 'relation type');

  const saveRelation = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    await updateRelationType({ id, patch });
  }, [updateRelationType]);

  const addRelation = useCallback(async (name: string, description: string) => {
    await createRelationType({ name, description: description || undefined });
  }, [createRelationType]);

  // File types
  const { data: fileTypes } = useFileTypesQuery();
  const { createFileType } = useCreateFileTypeMutation();
  const { updateFileType } = useUpdateFileTypeMutation();
  const { deleteFileType } = useDeleteFileTypeMutation();
  const { confirmDelete: confirmDeleteType } = useConfirmDelete(deleteFileType, 'file type');

  const saveType = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    await updateFileType({ id, patch });
  }, [updateFileType]);

  const addType = useCallback(async (name: string, description: string) => {
    await createFileType({ name, description: description || undefined });
  }, [createFileType]);

  // Techniques
  const { data: techniques } = useTechniquesQuery();
  const { createTechnique } = useCreateTechniqueMutation();
  const { updateTechnique } = useUpdateTechniqueMutation();
  const { deleteTechnique } = useDeleteTechniqueMutation();
  const { confirmDelete: confirmDeleteTechnique } = useConfirmDelete(deleteTechnique, 'technique');

  const saveTechnique = useCallback(async (id: string, patch: { name?: string; description?: string }) => {
    await updateTechnique({ id, patch });
  }, [updateTechnique]);

  const addTechnique = useCallback(async (name: string, description: string) => {
    await createTechnique({ name, description: description || undefined });
  }, [createTechnique]);

  // Engines
  const { data: engines } = useEnginesQuery();
  const { createEngine } = useCreateEngineMutation();
  const { updateEngine } = useUpdateEngineMutation();
  const { deleteEngine } = useDeleteEngineMutation();
  const { confirmDelete: confirmDeleteEngine } = useConfirmDelete(deleteEngine, 'engine');

  const saveEngine = useCallback(async (id: string, patch: { name?: string; url?: string }) => {
    await updateEngine({ id, patch });
  }, [updateEngine]);

  const addEngine = useCallback(async (name: string, url: string) => {
    await createEngine({ name, url });
  }, [createEngine]);

  return (
    <div className="flex flex-col gap-4 md:gap-5 p-2 md:p-3 max-w-2xl mx-auto w-full">
      <div>
        <Heading level="heading">Settings</Heading>
        <Text variant="dim">Manage reference data used across GenomeHub</Text>
      </div>

      <EngineTable>
        {(engines ?? []).map(e => (
          <EngineRow key={e.id} id={e.id} name={e.name} url={e.url} status={e.status}
            onSave={saveEngine} onDelete={confirmDeleteEngine} />
        ))}
        <EngineAddRow onAdd={addEngine} />
      </EngineTable>

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

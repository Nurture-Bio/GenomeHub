import { useMemo, type ReactNode } from 'react';
import ComboBox, { type ComboBoxItem } from './ComboBox';
import {
  useOrganismsQuery, useCollectionsQuery,
  useTechniquesQuery, useRelationTypesQuery, useFileTypesQuery,
  useCreateOrganismMutation,
  useCreateCollectionMutation,
  useCreateTechniqueMutation,
  useCreateRelationTypeMutation,
  useCreateFileTypeMutation,
} from '../hooks/useGenomicQueries';
// ── Shared helpers ───────────────────────────────────────

interface PickerBaseProps {
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  variant?: 'default' | 'surface';
  className?: string;
  disabled?: boolean;
  items?: ComboBoxItem[];
  trigger?: ReactNode;
}

// ── CollectionPicker ────────────────────────────────────

interface CollectionPickerProps extends PickerBaseProps {
  type?: string;
}

export function CollectionPicker({ value, onValueChange, type, placeholder = 'Collection', items: overrideItems, ...rest }: CollectionPickerProps) {
  const { data, isLoading } = useCollectionsQuery(
    type ? { type } : undefined,
  );
  const { createCollection } = useCreateCollectionMutation();

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(c => ({
      id: c.id,
      label: c.name,
      description: [...c.techniques.map(t => t.name), ...c.organisms.map(o => o.displayName)].filter(Boolean).join(' / '),
    }));
  }, [data, overrideItems]);

  const handleCreate = async (name: string) => {
    try {
      const created = await createCollection({ name });
      onValueChange(created.id);
    } catch { /* toast already shown */ }
  };

  return (
    <ComboBox
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      loading={!overrideItems && isLoading}
      onCreate={handleCreate}
      {...rest}
    />
  );
}

// ── OrganismPicker ───────────────────────────────────────

export function OrganismPicker({ value, onValueChange, placeholder = 'Organism', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useOrganismsQuery();
  const { createOrganism } = useCreateOrganismMutation();

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(o => ({
      id: o.id,
      label: o.displayName,
      description: [o.commonName, o.referenceGenome].filter(Boolean).join(' / '),
    }));
  }, [data, overrideItems]);

  const handleCreate = async (input: string) => {
    try {
      // Parse "Genus species strain" from typed text
      const parts = input.trim().split(/\s+/);
      const genus = parts[0];
      const species = parts[1] ?? 'sp.';
      const strain = parts.slice(2).join(' ') || undefined;
      const created = await createOrganism({ genus, species, strain });
      onValueChange(created.id);
    } catch { /* toast already shown */ }
  };

  return (
    <ComboBox
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      loading={!overrideItems && isLoading}
      onCreate={handleCreate}
      {...rest}
    />
  );
}

// ── FileTypePicker ──────────────────────────────────────
// Fetches from file_types table. Value is the type name (not id).

export function FileTypePicker({ value, onValueChange, placeholder = 'Type', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useFileTypesQuery();
  const { createFileType } = useCreateFileTypeMutation();

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(k => ({
      id: k.name,
      label: k.name,
      description: k.description ?? undefined,
    }));
  }, [data, overrideItems]);

  const handleCreate = async (name: string) => {
    try {
      const created = await createFileType({ name });
      onValueChange(created.name);
    } catch { /* toast already shown */ }
  };

  return (
    <ComboBox
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      loading={!overrideItems && isLoading}
      onCreate={overrideItems ? undefined : handleCreate}
      {...rest}
    />
  );
}

// ── TechniquePicker ─────────────────────────────────────

export function TechniquePicker({ value, onValueChange, placeholder = 'Technique', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useTechniquesQuery();
  const { createTechnique } = useCreateTechniqueMutation();

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(t => ({
      id: t.id,
      label: t.name,
      description: t.description ?? undefined,
    }));
  }, [data, overrideItems]);

  const handleCreate = async (name: string) => {
    try {
      const created = await createTechnique({ name });
      onValueChange(created.id);
    } catch { /* toast already shown */ }
  };

  return (
    <ComboBox
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      loading={!overrideItems && isLoading}
      onCreate={overrideItems ? undefined : handleCreate}
      {...rest}
    />
  );
}

// ── RelationPicker ─────────────────────────────────────
// Picks from relation_types table. Value is the relation name (not id).

export function RelationPicker({ value, onValueChange, placeholder = 'Relation', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useRelationTypesQuery();
  const { createRelationType } = useCreateRelationTypeMutation();

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(r => ({
      id: r.name,
      label: r.name.replace(/_/g, ' '),
      description: r.description ?? undefined,
    }));
  }, [data, overrideItems]);

  const handleCreate = async (name: string) => {
    try {
      const created = await createRelationType({ name });
      onValueChange(created.name);
    } catch { /* toast already shown */ }
  };

  return (
    <ComboBox
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      loading={!overrideItems && isLoading}
      onCreate={overrideItems ? undefined : handleCreate}
      {...rest}
    />
  );
}

import { useMemo, type ReactNode } from 'react';
import HashChipPopover, { type HashChipItem } from './HashChipPopover';
import {
  useOrganismsQuery, useCollectionsQuery,
  useTechniquesQuery, useRelationTypesQuery, useFileTypesQuery,
  useCreateOrganismMutation,
  useCreateCollectionMutation,
  useCreateTechniqueMutation,
  useCreateRelationTypeMutation,
  useCreateFileTypeMutation,
} from '../hooks/useGenomicQueries';

// ── Shared base ─────────────────────────────────────────

interface PickerBaseProps {
  value:          string;
  onValueChange:  (id: string) => void;
  placeholder?:   string;
  size?:          'sm' | 'md';
  variant?:       'default' | 'surface';
  className?:     string;
  disabled?:      boolean;
  trigger?:       ReactNode;
}

function EntityPicker({
  data,
  isLoading,
  mapItem,
  onCreate,
  ...rest
}: PickerBaseProps & {
  data:     unknown[] | undefined;
  isLoading: boolean;
  mapItem:   (item: any) => HashChipItem;
  onCreate?: (search: string) => void;
}) {
  const { value, onValueChange, trigger, placeholder, ...comboProps } = rest;

  const items = useMemo(
    () => (data ?? []).map(mapItem),
    [data, mapItem],
  );

  return (
    <HashChipPopover
      {...comboProps}
      items={items}
      value={value}
      onSelect={onValueChange}
      trigger={trigger}
      placeholder={placeholder}
      loading={isLoading}
      onCreate={onCreate}
    />
  );
}

// ── CollectionPicker ────────────────────────────────────

interface CollectionPickerProps extends PickerBaseProps {
  type?: string;
}

const mapCollection = (c: any): HashChipItem => ({
  id:          c.id,
  label:       c.name,
  description: [...c.techniques.map((t: any) => t.name), ...c.organisms.map((o: any) => o.displayName)].filter(Boolean).join(' / '),
});

export function CollectionPicker({ type, onValueChange, ...rest }: CollectionPickerProps) {
  const { data, isLoading } = useCollectionsQuery(type ? { type } : undefined);
  const { createCollection } = useCreateCollectionMutation();

  const handleCreate = async (name: string) => {
    try {
      const created = await createCollection({ name });
      onValueChange(created.id);
    } catch { /* toast already shown */ }
  };

  return (
    <EntityPicker
      {...rest}
      data={data}
      isLoading={isLoading}
      mapItem={mapCollection}
      onValueChange={onValueChange}
      onCreate={handleCreate}
    />
  );
}

// ── OrganismPicker ──────────────────────────────────────

const mapOrganism = (o: any): HashChipItem => ({
  id:          o.id,
  label:       o.displayName,
  description: [o.commonName, o.referenceGenome].filter(Boolean).join(' / '),
});

export function OrganismPicker({ onValueChange, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useOrganismsQuery();
  const { createOrganism } = useCreateOrganismMutation();

  const handleCreate = async (input: string) => {
    try {
      const parts = input.trim().split(/\s+/);
      const created = await createOrganism({
        genus:   parts[0],
        species: parts[1] ?? 'sp.',
        strain:  parts.slice(2).join(' ') || undefined,
      });
      onValueChange(created.id);
    } catch { /* toast already shown */ }
  };

  return (
    <EntityPicker
      {...rest}
      data={data}
      isLoading={isLoading}
      mapItem={mapOrganism}
      onValueChange={onValueChange}
      onCreate={handleCreate}
    />
  );
}

// ── FileTypePicker ──────────────────────────────────────

const mapFileType = (k: any): HashChipItem => ({
  id:          k.name,
  label:       k.name,
  description: k.description ?? undefined,
});

export function FileTypePicker({ onValueChange, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useFileTypesQuery();
  const { createFileType } = useCreateFileTypeMutation();

  const handleCreate = async (name: string) => {
    try {
      const created = await createFileType({ name });
      onValueChange(created.name);
    } catch { /* toast already shown */ }
  };

  return (
    <EntityPicker
      {...rest}
      data={data}
      isLoading={isLoading}
      mapItem={mapFileType}
      onValueChange={onValueChange}
      onCreate={handleCreate}
    />
  );
}

// ── TechniquePicker ─────────────────────────────────────

const mapTechnique = (t: any): HashChipItem => ({
  id:          t.id,
  label:       t.name,
  description: t.description ?? undefined,
});

export function TechniquePicker({ onValueChange, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useTechniquesQuery();
  const { createTechnique } = useCreateTechniqueMutation();

  const handleCreate = async (name: string) => {
    try {
      const created = await createTechnique({ name });
      onValueChange(created.id);
    } catch { /* toast already shown */ }
  };

  return (
    <EntityPicker
      {...rest}
      data={data}
      isLoading={isLoading}
      mapItem={mapTechnique}
      onValueChange={onValueChange}
      onCreate={handleCreate}
    />
  );
}

// ── RelationPicker ──────────────────────────────────────

const mapRelation = (r: any): HashChipItem => ({
  id:          r.name,
  label:       r.name.replace(/_/g, ' '),
  description: r.description ?? undefined,
});

export function RelationPicker({ onValueChange, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useRelationTypesQuery();
  const { createRelationType } = useCreateRelationTypeMutation();

  const handleCreate = async (name: string) => {
    try {
      const created = await createRelationType({ name });
      onValueChange(created.name);
    } catch { /* toast already shown */ }
  };

  return (
    <EntityPicker
      {...rest}
      data={data}
      isLoading={isLoading}
      mapItem={mapRelation}
      onValueChange={onValueChange}
      onCreate={handleCreate}
    />
  );
}

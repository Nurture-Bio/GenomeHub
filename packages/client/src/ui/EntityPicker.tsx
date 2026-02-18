import { useMemo } from 'react';
import ComboBox, { type ComboBoxItem } from './ComboBox';
import {
  useProjectsQuery, useOrganismsQuery, useCollectionsQuery,
  useTechniquesQuery,
  useCreateTechniqueMutation,
} from '../hooks/useGenomicQueries';
import { formatBytes } from '../lib/formats';
import { useAppStore } from '../stores/useAppStore';

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
}

function useRecent(kind: 'projects' | 'collections') {
  return useAppStore(s => s.recentSelections[kind]);
}

function useTrackSelection(kind: 'projects' | 'collections') {
  const add = useAppStore(s => s.addRecentSelection);
  return (id: string) => {
    if (id) add(kind, id);
  };
}

// ── ProjectPicker ────────────────────────────────────────

export function ProjectPicker({ value, onValueChange, placeholder = 'Project', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useProjectsQuery();
  const recentIds = useRecent('projects');
  const track = useTrackSelection('projects');

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(p => ({
      id: p.id,
      label: p.name,
      description: `${p.fileCount} files, ${formatBytes(p.totalBytes)}`,
    }));
  }, [data, overrideItems]);

  return (
    <ComboBox
      items={items}
      value={value}
      onValueChange={id => { track(id); onValueChange(id); }}
      placeholder={placeholder}
      recentIds={recentIds}
      loading={!overrideItems && isLoading}
      {...rest}
    />
  );
}

// ── CollectionPicker ────────────────────────────────────

interface CollectionPickerProps extends PickerBaseProps {
  projectId?: string;
  kind?: string;
}

export function CollectionPicker({ value, onValueChange, projectId, kind, placeholder = 'Collection', items: overrideItems, ...rest }: CollectionPickerProps) {
  const { data, isLoading } = useCollectionsQuery(
    projectId || kind ? { projectId, kind } : undefined,
  );
  const recentIds = useRecent('collections');
  const track = useTrackSelection('collections');

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(c => ({
      id: c.id,
      label: c.name,
      description: [c.techniqueName, c.organismDisplay].filter(Boolean).join(' / '),
      group: c.projectName ?? undefined,
    }));
  }, [data, overrideItems]);

  return (
    <ComboBox
      items={items}
      value={value}
      onValueChange={id => { track(id); onValueChange(id); }}
      placeholder={placeholder}
      recentIds={recentIds}
      loading={!overrideItems && isLoading}
      {...rest}
    />
  );
}

// ── OrganismPicker ───────────────────────────────────────

export function OrganismPicker({ value, onValueChange, placeholder = 'Organism', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useOrganismsQuery();

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(o => ({
      id: o.id,
      label: o.displayName,
      description: [o.commonName, o.referenceGenome].filter(Boolean).join(' / '),
    }));
  }, [data, overrideItems]);

  return (
    <ComboBox
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      loading={!overrideItems && isLoading}
      {...rest}
    />
  );
}

// ── FileKindPicker ──────────────────────────────────────

const FILE_KINDS: ComboBoxItem[] = [
  { id: 'library',    label: 'Library',    description: 'Library prep (fastq)' },
  { id: 'sample',     label: 'Sample',     description: 'Raw sample data' },
  { id: 'reference',  label: 'Reference',  description: 'Reference genome/assembly' },
  { id: 'alignment',  label: 'Alignment',  description: 'Aligned reads (bam/cram)' },
  { id: 'counts',     label: 'Counts',     description: 'Count matrix' },
  { id: 'annotation', label: 'Annotation', description: 'Genome annotation (gff/gtf)' },
  { id: 'qc',         label: 'QC',         description: 'Quality control report' },
  { id: 'index',      label: 'Index',      description: 'Index file' },
  { id: 'raw',        label: 'Raw',        description: 'Unclassified file' },
  { id: 'other',      label: 'Other',      description: 'Other file type' },
];

export function FileKindPicker({ value, onValueChange, placeholder = 'Kind', ...rest }: PickerBaseProps) {
  return (
    <ComboBox
      items={FILE_KINDS}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      {...rest}
    />
  );
}

// ── TechniquePicker ─────────────────────────────────────

export function TechniquePicker({ value, onValueChange, placeholder = 'Technique', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading, refetch } = useTechniquesQuery();
  const { createTechnique } = useCreateTechniqueMutation(refetch);

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
      await refetch();
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

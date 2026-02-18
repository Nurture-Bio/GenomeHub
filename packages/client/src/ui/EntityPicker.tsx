import { useMemo } from 'react';
import ComboBox, { type ComboBoxItem } from './ComboBox';
import {
  useProjectsQuery, useOrganismsQuery, useExperimentsQuery,
  useDatasetsQuery, useExperimentTypesQuery,
  useCreateExperimentTypeMutation,
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

function useRecent(kind: 'projects' | 'experiments' | 'datasets') {
  return useAppStore(s => s.recentSelections[kind]);
}

function useTrackSelection(kind: 'projects' | 'experiments' | 'datasets') {
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

// ── ExperimentPicker ─────────────────────────────────────

interface ExperimentPickerProps extends PickerBaseProps {
  projectId?: string;
}

export function ExperimentPicker({ value, onValueChange, projectId, placeholder = 'Experiment', items: overrideItems, ...rest }: ExperimentPickerProps) {
  const { data, isLoading } = useExperimentsQuery(projectId ? { projectId } : undefined);
  const recentIds = useRecent('experiments');
  const track = useTrackSelection('experiments');

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(e => ({
      id: e.id,
      label: e.name,
      description: [e.experimentTypeName, e.organismDisplay].filter(Boolean).join(' / '),
      group: e.projectName ?? undefined,
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

// ── DatasetPicker ───────────────────────────────────────

interface DatasetPickerProps extends PickerBaseProps {
  experimentId?: string;
}

export function DatasetPicker({ value, onValueChange, experimentId, placeholder = 'Dataset', items: overrideItems, ...rest }: DatasetPickerProps) {
  const { data, isLoading } = useDatasetsQuery(experimentId ? { experimentId } : undefined);
  const recentIds = useRecent('datasets');
  const track = useTrackSelection('datasets');

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(d => ({
      id: d.id,
      label: d.name,
      description: [d.kind, d.condition, d.replicate != null ? `rep ${d.replicate}` : null].filter(Boolean).join(', '),
      group: d.experimentName ?? undefined,
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

// ── ExperimentTypePicker ─────────────────────────────────

export function ExperimentTypePicker({ value, onValueChange, placeholder = 'Technique', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading, refetch } = useExperimentTypesQuery();
  const { createExperimentType } = useCreateExperimentTypeMutation(refetch);

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
      const created = await createExperimentType({ name });
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

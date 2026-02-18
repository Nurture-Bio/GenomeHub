import { useMemo } from 'react';
import ComboBox, { type ComboBoxItem } from './ComboBox';
import {
  useProjectsQuery, useOrganismsQuery, useExperimentsQuery,
  useSamplesQuery, useExperimentTypesQuery,
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

function useRecent(kind: 'projects' | 'experiments' | 'samples') {
  return useAppStore(s => s.recentSelections[kind]);
}

function useTrackSelection(kind: 'projects' | 'experiments' | 'samples') {
  const add = useAppStore(s => s.addRecentSelection);
  return (id: string) => {
    if (id) add(kind, id);
  };
}

// ── ProjectPicker ────────────────────────────────────────

export function ProjectPicker({ value, onValueChange, placeholder = 'Select project\u2026', items: overrideItems, ...rest }: PickerBaseProps) {
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

export function ExperimentPicker({ value, onValueChange, projectId, placeholder = 'Select experiment\u2026', items: overrideItems, ...rest }: ExperimentPickerProps) {
  const { data, isLoading } = useExperimentsQuery(projectId ? { projectId } : undefined);
  const recentIds = useRecent('experiments');
  const track = useTrackSelection('experiments');

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(e => ({
      id: e.id,
      label: e.name,
      description: [e.technique, e.organismDisplay].filter(Boolean).join(' / '),
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

export function OrganismPicker({ value, onValueChange, placeholder = 'Select organism\u2026', items: overrideItems, ...rest }: PickerBaseProps) {
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

// ── SamplePicker ─────────────────────────────────────────

interface SamplePickerProps extends PickerBaseProps {
  experimentId?: string;
}

export function SamplePicker({ value, onValueChange, experimentId, placeholder = 'Select sample\u2026', items: overrideItems, ...rest }: SamplePickerProps) {
  const { data, isLoading } = useSamplesQuery(experimentId);
  const recentIds = useRecent('samples');
  const track = useTrackSelection('samples');

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(s => ({
      id: s.id,
      label: s.name,
      description: [s.condition, s.replicate != null ? `rep ${s.replicate}` : null].filter(Boolean).join(', '),
      group: s.experimentName ?? undefined,
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

export function ExperimentTypePicker({ value, onValueChange, placeholder = 'Select technique\u2026', items: overrideItems, ...rest }: PickerBaseProps) {
  const { data, isLoading } = useExperimentTypesQuery();

  const items = useMemo(() => {
    if (overrideItems) return overrideItems;
    return (data ?? []).map(t => ({
      id: t.id,
      label: t.name,
      description: t.description ?? undefined,
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

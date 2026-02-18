import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useExperimentDetailQuery, useCreateDatasetMutation } from '../hooks/useGenomicQueries';
import type { DatasetKind } from '../hooks/useGenomicQueries';
import { TechniquePill } from '../lib/techniqueColors';
import { Heading, Text, Card, Badge, Input, Button } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

const DATASET_KINDS: DatasetKind[] = ['sample', 'library', 'reference', 'pool', 'control', 'other'];

export default function ExperimentDetailPage() {
  const { experimentId } = useParams<{ experimentId: string }>();
  const { data: experiment, isLoading, refetch } = useExperimentDetailQuery(experimentId);
  const { createDataset, pending } = useCreateDatasetMutation(refetch);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);

  // Create dataset form state
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DatasetKind>('sample');
  const [condition, setCondition] = useState('');
  const [replicate, setReplicate] = useState('');

  useEffect(() => {
    if (experiment && experimentId) setBreadcrumbLabel(experimentId, experiment.name);
  }, [experiment, experimentId, setBreadcrumbLabel]);

  const handleCreate = async () => {
    if (!name || !experimentId) return;
    await createDataset({
      experimentId,
      name,
      kind,
      condition: condition || undefined,
      replicate: replicate ? Number(replicate) : undefined,
    });
    setName(''); setCondition(''); setReplicate('');
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <div className="skeleton h-6 w-48 rounded-sm" />
        <div className="skeleton h-4 w-72 rounded-sm" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="p-3"><div className="skeleton h-16 rounded-sm" /></Card>
          ))}
        </div>
      </div>
    );
  }

  if (!experiment) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <Heading level="heading">Experiment not found</Heading>
        <Text variant="caption">The experiment may have been deleted.</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          {experiment.experimentType?.name && (
            <TechniquePill name={experiment.experimentType.name} />
          )}
          <Badge variant="status" color={
            experiment.status === 'active' ? 'green'
            : experiment.status === 'complete' ? 'blue'
            : 'dim'
          }>
            {experiment.status}
          </Badge>
        </div>
        <Heading level="heading">{experiment.name}</Heading>
        {experiment.description && <Text variant="caption">{experiment.description}</Text>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {experiment.organismDisplay && <Text variant="caption" className="italic">{experiment.organismDisplay}</Text>}
          {experiment.projectName && (
            <Link to={`/projects/${experiment.projectId}`} className="no-underline">
              <Badge variant="count" color="dim">{experiment.projectName}</Badge>
            </Link>
          )}
          <Badge variant="count" color="accent">{experiment.fileCount} files</Badge>
          <Badge variant="count" color="dim">{experiment.datasets.length} datasets</Badge>
        </div>
      </div>

      {/* Add Dataset form */}
      <div className="flex items-end gap-2 flex-wrap bg-surface border border-border rounded-md p-2.5">
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Name</Text>
          <Input variant="surface" size="sm" placeholder="Dataset name" value={name} onChange={e => setName(e.target.value)} className="w-full sm:w-52" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Kind</Text>
          <select
            value={kind}
            onChange={e => setKind(e.target.value as DatasetKind)}
            className="font-body text-caption bg-surface-2 border border-border rounded-sm px-2 py-1 min-h-7"
          >
            {DATASET_KINDS.map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Condition</Text>
          <Input variant="surface" size="sm" placeholder="e.g. treated" value={condition} onChange={e => setCondition(e.target.value)} className="w-full sm:w-36" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Replicate</Text>
          <Input variant="surface" size="sm" type="number" placeholder="#" value={replicate} onChange={e => setReplicate(e.target.value)} className="w-full sm:w-20" />
        </div>
        <Button intent="primary" size="sm" pending={pending} onClick={handleCreate} disabled={!name} className="w-full sm:w-auto">
          Add Dataset
        </Button>
      </div>

      {/* Datasets grid */}
      <div>
        <Text variant="overline" className="mb-1.5 block">Datasets</Text>
        {experiment.datasets.length === 0 ? (
          <Text variant="caption">No datasets yet.</Text>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {experiment.datasets.map(dataset => (
              <Link
                key={dataset.id}
                to={`/experiments/${experimentId}/datasets/${dataset.id}`}
                className="no-underline"
              >
                <Card className="p-2.5 flex flex-col gap-1 hover:border-accent transition-colors duration-fast cursor-pointer h-full">
                  <div className="flex items-center gap-2">
                    <Badge variant="count" color="dim">{dataset.kind}</Badge>
                    <span className="font-mono text-caption text-text truncate flex-1">{dataset.name}</span>
                  </div>
                  {dataset.description && <Text variant="caption" className="truncate">{dataset.description}</Text>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {dataset.condition && <Badge variant="filter">{dataset.condition}</Badge>}
                    {dataset.replicate != null && <Text variant="caption">rep {dataset.replicate}</Text>}
                    <Text variant="caption">{dataset.fileCount} files</Text>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Links */}
      <LinksList parentType="experiment" parentId={experimentId!} />
    </div>
  );
}

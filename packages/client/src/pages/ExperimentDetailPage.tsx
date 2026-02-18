import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useExperimentDetailQuery, useCreateSampleMutation } from '../hooks/useGenomicQueries';
import { TechniquePill } from '../lib/techniqueColors';
import { Heading, Text, Card, Badge, Input, Button } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

export default function ExperimentDetailPage() {
  const { experimentId } = useParams<{ experimentId: string }>();
  const { data: experiment, isLoading, refetch } = useExperimentDetailQuery(experimentId);
  const { createSample, pending } = useCreateSampleMutation(refetch);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);

  // Create sample form state
  const [name, setName] = useState('');
  const [condition, setCondition] = useState('');
  const [replicate, setReplicate] = useState('');

  useEffect(() => {
    if (experiment && experimentId) setBreadcrumbLabel(experimentId, experiment.name);
  }, [experiment, experimentId, setBreadcrumbLabel]);

  const handleCreate = async () => {
    if (!name || !experimentId) return;
    await createSample({
      experimentId,
      name,
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
          <Badge variant="count" color="dim">{experiment.samples.length} samples</Badge>
        </div>
      </div>

      {/* Add Sample form */}
      <div className="flex items-end gap-2 flex-wrap bg-surface border border-border rounded-md p-2.5">
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Name</Text>
          <Input variant="surface" size="sm" placeholder="Sample name" value={name} onChange={e => setName(e.target.value)} className="w-full sm:w-52" />
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
          Add Sample
        </Button>
      </div>

      {/* Samples grid */}
      <div>
        <Text variant="overline" className="mb-1.5 block">Samples</Text>
        {experiment.samples.length === 0 ? (
          <Text variant="caption">No samples yet.</Text>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {experiment.samples.map(sample => (
              <Link
                key={sample.id}
                to={`/experiments/${experimentId}/samples/${sample.id}`}
                className="no-underline"
              >
                <Card className="p-2.5 flex flex-col gap-1 hover:border-accent transition-colors duration-fast cursor-pointer h-full">
                  <span className="font-mono text-caption text-text">{sample.name}</span>
                  {sample.description && <Text variant="caption" className="truncate">{sample.description}</Text>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {sample.condition && <Badge variant="filter">{sample.condition}</Badge>}
                    {sample.replicate != null && <Text variant="caption">rep {sample.replicate}</Text>}
                    <Text variant="caption">{sample.fileCount} files</Text>
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

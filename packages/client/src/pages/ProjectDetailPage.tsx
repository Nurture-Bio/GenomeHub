import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useProjectTreeQuery, useCreateExperimentMutation,
  useExperimentTypesQuery,
} from '../hooks/useGenomicQueries';
import { TechniquePill } from '../lib/techniqueColors';
import { Heading, Text, Card, Badge, Input, Button } from '../ui';
import { ExperimentTypePicker, OrganismPicker } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: tree, isLoading, refetch } = useProjectTreeQuery(projectId);
  const { createExperiment, pending } = useCreateExperimentMutation(refetch);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);

  // Create experiment form state
  const [name, setName] = useState('');
  const [experimentTypeId, setExperimentTypeId] = useState('');
  const [organismId, setOrganismId] = useState('');

  useEffect(() => {
    if (tree && projectId) setBreadcrumbLabel(projectId, tree.name);
  }, [tree, projectId, setBreadcrumbLabel]);

  const handleCreate = async () => {
    if (!name || !experimentTypeId || !projectId) return;
    await createExperiment({
      name, projectId, experimentTypeId,
      organismId: organismId || undefined,
    });
    setName(''); setExperimentTypeId(''); setOrganismId('');
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

  if (!tree) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <Heading level="heading">Project not found</Heading>
        <Text variant="caption">The project may have been deleted.</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3">
      {/* Header */}
      <div>
        <Heading level="heading">{tree.name}</Heading>
        {tree.description && <Text variant="caption">{tree.description}</Text>}
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="count" color="accent">{tree.fileCount} files</Badge>
          <Badge variant="count" color="dim">{tree.experiments.length} experiments</Badge>
        </div>
      </div>

      {/* Add Experiment form */}
      <div className="flex items-end gap-2 flex-wrap bg-surface border border-border rounded-md p-2.5">
        <div className="flex flex-col gap-0.5 w-full sm:w-auto">
          <Text variant="overline">Name</Text>
          <Input variant="surface" size="sm" placeholder="Experiment name" value={name} onChange={e => setName(e.target.value)} className="w-full sm:w-52" />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Technique</Text>
          <ExperimentTypePicker
            value={experimentTypeId}
            onValueChange={setExperimentTypeId}
            variant="surface"
            size="sm"
            className="w-full sm:w-36"
          />
        </div>
        <div className="flex flex-col gap-0.5 w-[calc(50%-4px)] sm:w-auto">
          <Text variant="overline">Organism</Text>
          <OrganismPicker
            value={organismId}
            onValueChange={setOrganismId}
            variant="surface"
            size="sm"
            className="w-full sm:w-40"
          />
        </div>
        <Button intent="primary" size="sm" pending={pending} onClick={handleCreate} disabled={!name || !experimentTypeId} className="w-full sm:w-auto">
          Add Experiment
        </Button>
      </div>

      {/* Experiments grid */}
      <div>
        <Text variant="overline" className="mb-1.5 block">Experiments</Text>
        {tree.experiments.length === 0 ? (
          <Text variant="caption">No experiments yet.</Text>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {tree.experiments.map(exp => (
              <Link
                key={exp.id}
                to={`/projects/${projectId}/experiments/${exp.id}`}
                className="no-underline"
              >
                <Card className="p-2.5 flex flex-col gap-1.5 hover:border-accent transition-colors duration-fast cursor-pointer h-full">
                  <div className="flex items-center gap-2">
                    {(exp.experimentType?.name || exp.technique) && (
                      <TechniquePill name={exp.experimentType?.name ?? exp.technique!} />
                    )}
                    <span className="font-mono text-caption text-text truncate flex-1 min-w-0">{exp.name}</span>
                  </div>
                  {exp.description && <Text variant="caption" className="truncate">{exp.description}</Text>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {exp.organism && <Text variant="caption" className="italic">{exp.organism}</Text>}
                    <Text variant="caption">{exp.samples.length} samples</Text>
                    <Text variant="caption">{exp.fileCount} files</Text>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Links */}
      <LinksList parentType="project" parentId={projectId!} />
    </div>
  );
}

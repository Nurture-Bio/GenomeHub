import { useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectTreeQuery } from '../hooks/useGenomicQueries';
import { TECHNIQUE_META, type Technique } from '../lib/techniques';
import { Heading, Text, Card, Badge } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

function TechniquePill({ technique }: { technique: string }) {
  const meta = TECHNIQUE_META[technique as Technique] ?? TECHNIQUE_META.other;
  return (
    <span className="font-mono text-micro px-1.5 py-0.5 rounded-sm inline-block"
      style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

export default function ExperimentDetailPage() {
  const { projectId, experimentId } = useParams<{
    projectId: string;
    experimentId: string;
  }>();
  const { data: tree, isLoading } = useProjectTreeQuery(projectId);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);

  const experiment = useMemo(() =>
    tree?.experiments.find(e => e.id === experimentId),
    [tree, experimentId],
  );

  useEffect(() => {
    if (tree && projectId) setBreadcrumbLabel(projectId, tree.name);
    if (experiment && experimentId) setBreadcrumbLabel(experimentId, experiment.name);
  }, [tree, experiment, projectId, experimentId, setBreadcrumbLabel]);

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
          {experiment.technique && <TechniquePill technique={experiment.technique} />}
          {experiment.experimentType && (
            <Badge variant="filter">{experiment.experimentType.name}</Badge>
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
          {experiment.organism && <Text variant="caption" className="italic">{experiment.organism}</Text>}
          <Badge variant="count" color="accent">{experiment.fileCount} files</Badge>
          <Badge variant="count" color="dim">{experiment.samples.length} samples</Badge>
        </div>
      </div>

      {/* Links */}
      <LinksList parentType="experiment" parentId={experimentId!} />

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
                to={`/projects/${projectId}/experiments/${experimentId}/samples/${sample.id}`}
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
    </div>
  );
}

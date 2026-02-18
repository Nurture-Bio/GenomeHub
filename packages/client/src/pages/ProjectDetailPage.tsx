import { useEffect } from 'react';
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

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: tree, isLoading } = useProjectTreeQuery(projectId);
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);

  useEffect(() => {
    if (tree && projectId) setBreadcrumbLabel(projectId, tree.name);
  }, [tree, projectId, setBreadcrumbLabel]);

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

      {/* Links */}
      <LinksList parentType="project" parentId={projectId!} />

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
                    {exp.technique && <TechniquePill technique={exp.technique} />}
                    {exp.experimentType && !exp.technique && (
                      <Badge variant="filter">{exp.experimentType.name}</Badge>
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
    </div>
  );
}

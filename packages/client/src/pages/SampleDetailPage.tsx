import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProjectTreeQuery, useFilesQuery, type GenomicFile } from '../hooks/useGenomicQueries';
import { detectFormat, FORMAT_META, formatBytes, formatRelativeTime } from '../lib/formats';
import { Heading, Text, Card, Badge } from '../ui';
import LinksList from '../components/LinksList';
import { useAppStore } from '../stores/useAppStore';

export default function SampleDetailPage() {
  const { projectId, experimentId, sampleId } = useParams<{
    projectId: string;
    experimentId: string;
    sampleId: string;
  }>();
  const { data: tree, isLoading: treeLoading } = useProjectTreeQuery(projectId);
  const { data: files, isLoading: filesLoading } = useFilesQuery({ sampleId });
  const setBreadcrumbLabel = useAppStore(s => s.setBreadcrumbLabel);

  const experiment = useMemo(() =>
    tree?.experiments.find(e => e.id === experimentId),
    [tree, experimentId],
  );

  const sample = useMemo(() =>
    experiment?.samples.find(s => s.id === sampleId),
    [experiment, sampleId],
  );

  useEffect(() => {
    if (tree && projectId) setBreadcrumbLabel(projectId, tree.name);
    if (experiment && experimentId) setBreadcrumbLabel(experimentId, experiment.name);
    if (sample && sampleId) setBreadcrumbLabel(sampleId, sample.name);
  }, [tree, experiment, sample, projectId, experimentId, sampleId, setBreadcrumbLabel]);

  const isLoading = treeLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <div className="skeleton h-6 w-48 rounded-sm" />
        <div className="skeleton h-4 w-72 rounded-sm" />
      </div>
    );
  }

  if (!sample) {
    return (
      <div className="flex flex-col gap-3 p-2 md:p-3">
        <Heading level="heading">Sample not found</Heading>
        <Text variant="caption">The sample may have been deleted.</Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:gap-3 p-2 md:p-3">
      {/* Header */}
      <div>
        <Heading level="heading">{sample.name}</Heading>
        {sample.description && <Text variant="caption">{sample.description}</Text>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {sample.condition && <Badge variant="filter">{sample.condition}</Badge>}
          {sample.replicate != null && <Text variant="caption">rep {sample.replicate}</Text>}
          <Badge variant="count" color="accent">{sample.fileCount} files</Badge>
        </div>
      </div>

      {/* Metadata */}
      {sample.metadata && Object.keys(sample.metadata).length > 0 && (
        <div className="bg-surface border border-border rounded-md p-2.5">
          <Text variant="overline" className="mb-1 block">Metadata</Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {Object.entries(sample.metadata).map(([key, val]) => (
              <div key={key} className="flex gap-2">
                <Text variant="label" className="shrink-0">{key}:</Text>
                <Text variant="body" className="truncate">{String(val)}</Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files */}
      <div>
        <Text variant="overline" className="mb-1.5 block">Files</Text>
        {filesLoading ? (
          <div className="flex flex-col gap-1">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="skeleton h-10 rounded-md" />
            ))}
          </div>
        ) : !files?.length ? (
          <Text variant="caption">No files associated with this sample.</Text>
        ) : (
          <div className="flex flex-col gap-1">
            {files.map(file => (
              <SampleFileRow key={file.id} file={file} />
            ))}
          </div>
        )}
      </div>

      {/* Links */}
      <LinksList parentType="sample" parentId={sampleId!} />
    </div>
  );
}

function SampleFileRow({ file }: { file: GenomicFile }) {
  const fmt = detectFormat(file.filename);
  const meta = FORMAT_META[fmt];

  return (
    <Card className="p-2 flex items-center gap-2">
      <div className="font-mono text-micro px-1.5 py-0.5 rounded-sm shrink-0 font-bold"
        style={{ background: meta.bg, color: meta.color }}>
        {meta.label}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-caption text-text truncate">{file.filename}</div>
        {file.description && <div className="text-micro text-text-dim truncate">{file.description}</div>}
      </div>
      <Text variant="caption" className="shrink-0">{formatBytes(file.sizeBytes)}</Text>
      {file.status === 'ready' && <Badge variant="status" color="green">ready</Badge>}
      {file.status === 'pending' && <Badge variant="status" color="yellow">uploading</Badge>}
      {file.status === 'error' && <Badge variant="status" color="red">error</Badge>}
      <Text variant="caption" className="shrink-0 hidden sm:block">{formatRelativeTime(file.uploadedAt)}</Text>
    </Card>
  );
}

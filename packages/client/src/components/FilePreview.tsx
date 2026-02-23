import { useFilePreview } from '../hooks/useGenomicQueries';
import { Text, Badge } from '../ui';

interface FilePreviewProps {
  fileId: string;
  filename: string;
}

// ── Main preview component ──────────────────────────────

export default function FilePreview({ fileId, filename }: FilePreviewProps) {
  const { data, isLoading } = useFilePreview(fileId);

  if (isLoading) {
    return <div className="skeleton h-32 rounded-md" />;
  }

  if (!data || !data.previewable || data.lines.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Text variant="overline">Preview</Text>
        {data.truncated && (
          <Badge variant="count" color="dim">first {data.lines.length} lines</Badge>
        )}
      </div>
      <div
        className="overflow-auto rounded-md border border-border"
        style={{ background: 'var(--color-bg-deep)', maxHeight: 400 }}
      >
        <pre className="font-mono text-micro text-text-secondary p-2 m-0 leading-relaxed">
          <code>{data.lines.join('\n')}</code>
        </pre>
      </div>
    </div>
  );
}

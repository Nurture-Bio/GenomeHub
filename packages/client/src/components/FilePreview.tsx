import { useFilePreview, useTrackSummary } from '../hooks/useGenomicQueries';
import { Text, Badge } from '../ui';

interface FilePreviewProps {
  fileId: string;
  filename: string;
}

// ── Track region type ───────────────────────────────────

interface TrackRegion {
  chrom: string;
  start: number;
  end: number;
  strand?: string;
  name?: string;
  score?: number;
  tags?: Record<string, unknown>;
}

function isTrackData(lines: string[]): TrackRegion[] | null {
  try {
    const joined = lines.join('\n');
    // Quick check: does it look like JSON array of regions?
    if (!joined.trimStart().startsWith('[')) return null;
    const data = JSON.parse(joined);
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0];
    if (typeof first !== 'object' || !('chrom' in first) || !('start' in first) || !('end' in first)) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Track table preview ─────────────────────────────────

function TrackPreview({ regions }: { regions: TrackRegion[] }) {
  const MAX_ROWS = 50;
  const shown = regions.slice(0, MAX_ROWS);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Text variant="overline">Track Preview</Text>
        <Badge variant="count" color="dim">{regions.length.toLocaleString()} regions</Badge>
        {regions.length > MAX_ROWS && (
          <Badge variant="count" color="dim">showing first {MAX_ROWS}</Badge>
        )}
      </div>
      <div
        className="overflow-auto rounded-md border border-border"
        style={{ background: 'var(--color-bg-deep)', maxHeight: 400 }}
      >
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0" style={{ background: 'var(--color-surface-2)' }}>
            <tr>
              <th className="px-2 py-1"><Text variant="overline">chrom</Text></th>
              <th className="px-2 py-1 text-right"><Text variant="overline">start</Text></th>
              <th className="px-2 py-1 text-right"><Text variant="overline">end</Text></th>
              <th className="px-2 py-1"><Text variant="overline">strand</Text></th>
              <th className="px-2 py-1"><Text variant="overline">name</Text></th>
              <th className="px-2 py-1 text-right"><Text variant="overline">score</Text></th>
              <th className="px-2 py-1"><Text variant="overline">tags</Text></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-t border-border-subtle">
                <td className="px-2 py-0.5"><Text variant="mono" className="text-micro">{r.chrom}</Text></td>
                <td className="px-2 py-0.5 text-right"><Text variant="mono" className="text-micro">{r.start.toLocaleString()}</Text></td>
                <td className="px-2 py-0.5 text-right"><Text variant="mono" className="text-micro">{r.end.toLocaleString()}</Text></td>
                <td className="px-2 py-0.5"><Text variant="mono" className="text-micro">{r.strand ?? '.'}</Text></td>
                <td className="px-2 py-0.5 max-w-32 truncate"><Text variant="mono" className="text-micro">{r.name ?? ''}</Text></td>
                <td className="px-2 py-0.5 text-right"><Text variant="mono" className="text-micro">{r.score ?? 0}</Text></td>
                <td className="px-2 py-0.5">
                  <div className="flex gap-0.5 flex-wrap">
                    {Object.entries(r.tags ?? {}).slice(0, 3).map(([k, v]) => (
                      <Badge key={k} variant="count" color="dim">
                        {k}={String(v).slice(0, 16)}
                      </Badge>
                    ))}
                    {Object.keys(r.tags ?? {}).length > 3 && (
                      <Badge variant="count" color="dim">+{Object.keys(r.tags!).length - 3}</Badge>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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

  // Try structured track preview for JSON files
  if (data.format === 'json') {
    const trackData = isTrackData(data.lines);
    if (trackData) {
      return <TrackPreview regions={trackData} />;
    }
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

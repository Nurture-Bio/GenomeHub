import { Link } from 'react-router-dom';
import { usePipelineErrors } from '../hooks/useGenomicQueries';
import { formatBytes, formatRelativeTime } from '../lib/formats';
import { Heading, Text, Badge } from '../ui';
import LoadingCrossfade from '../components/LoadingCrossfade';

export default function ErrorsPage() {
  const { data, isLoading, isError } = usePipelineErrors();

  const count = data?.length ?? 0;

  return (
    <div className="flex flex-col gap-3 md:gap-4 p-2 md:p-5 h-full min-h-0 animate-page-enter">
      {/* Header */}
      <div className="shrink-0">
        <Heading level="title">Pipeline Errors</Heading>
        <Text variant="dim">
          {data
            ? `${count} failed conversion${count !== 1 ? 's' : ''}`
            : isError
              ? '—'
              : <span className="skeleton h-[1lh] w-16 inline-block align-middle rounded-sm" />}
        </Text>
      </div>

      {/* Table */}
      <div className="flex flex-col flex-1 min-h-0 border border-line rounded-md bg-base overflow-hidden">
        {/* Header row */}
        <div className="shrink-0 border-b border-line bg-raised tbl-row">
          <div className="grid items-center" style={{ gridTemplateColumns: '1fr 80px 100px 100px', gap: '0 12px' }}>
            <Text variant="muted">File</Text>
            <Text variant="muted">Size</Text>
            <Text variant="muted">Failed</Text>
            <Text variant="muted">Status</Text>
          </div>
        </div>

        <LoadingCrossfade
          isLoading={isLoading && !isError}
          skeleton={
            <div className="flex-1 overflow-auto min-h-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="grid items-center border-b border-line tbl-row"
                  style={{ gridTemplateColumns: '1fr 80px 100px 100px', gap: '0 12px' }}>
                  <div className="skeleton h-[1lh] w-3/4" />
                  <div className="skeleton h-[1lh] w-12" />
                  <div className="skeleton h-[1lh] w-16" />
                  <div className="skeleton h-[1lh] w-12 rounded-full" />
                </div>
              ))}
            </div>
          }
        >
          {count === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Text variant="body" className="text-fg-3 animate-fade-up">No pipeline errors.</Text>
            </div>
          ) : (
            <div className="flex-1 overflow-auto min-h-0" style={{ scrollbarGutter: 'stable' }}>
              {data!.map((f, i) => (
                <div
                  key={f.id}
                  className="border-b border-line transition-colors duration-fast hover:bg-base stagger-item"
                  style={{ '--i': Math.min(i, 15) } as React.CSSProperties}
                >
                  {/* Summary row */}
                  <div className="grid items-center tbl-row"
                    style={{ gridTemplateColumns: '1fr 80px 100px 100px', gap: '0 12px' }}>
                    <div className="min-w-0">
                      <Link to={`/files/${f.id}`} className="no-underline">
                        <span className="font-mono text-sm truncate block hover:text-cyan transition-colors duration-fast tabular-nums">
                          {f.filename}
                        </span>
                      </Link>
                    </div>
                    <Text variant="dim">{formatBytes(f.sizeBytes)}</Text>
                    <Text variant="dim">{formatRelativeTime(f.updatedAt)}</Text>
                    <Badge variant="status" color="red">failed</Badge>
                  </div>

                  {/* Error detail */}
                  {f.parquetError && (
                    <div className="px-3 pb-2">
                      <div
                        className="font-mono rounded border border-line px-3 py-2"
                        style={{
                          fontSize: 'calc(var(--font-size-xs) - 1px)',
                          color: 'var(--color-fg-3)',
                          background: 'var(--color-void)',
                          wordBreak: 'break-word',
                          lineHeight: 1.5,
                        }}
                      >
                        {f.parquetError}
                      </div>
                      <Text variant="dim" style={{ fontSize: 'var(--font-size-xs)', marginTop: 4 }}>
                        File ID: {f.id}
                      </Text>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </LoadingCrossfade>
      </div>
    </div>
  );
}

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useInfiniteFilePreview } from '../hooks/useGenomicQueries';
import type { FilePreviewPage } from '../hooks/useGenomicQueries';
import { usePresignedUrl } from '../hooks/useGenomicQueries';
import { useJsonDuckDb } from '../hooks/useJsonDuckDb';
import { Text, Badge } from '../ui';
import { input } from '../ui/recipes';

interface FilePreviewProps {
  fileId:   string;
  filename: string;
}

// ── DuckDB JSON preview ──────────────────────────────────

function JsonDuckDbPreview({ fileId }: { fileId: string }) {
  const { getUrl }                      = usePresignedUrl();
  const [filters, setFilters]           = useState<Record<string, string>>({});
  const [result, setResult]             = useState<{ rows: Record<string, unknown>[]; filteredCount: number; error?: string } | null>(null);
  const [queryError, setQueryError]     = useState<string | null>(null);

  const getFileUrl = useCallback(() => getUrl(fileId), [getUrl, fileId]);
  const { status, columns, totalRows, error, query } = useJsonDuckDb(fileId, getFileUrl);

  // Run initial query once table is ready
  useEffect(() => {
    if (status === 'ready') {
      query({}).then(r => { if (r) setResult(r); });
    }
  }, [status, query]);

  const handleFilterChange = useCallback((key: string, val: string) => {
    setFilters(prev => {
      const next = { ...prev, [key]: val };
      query(next).then(r => {
        if (!r) return;
        if (r.error) setQueryError(r.error);
        else { setResult(r); setQueryError(null); }
      });
      return next;
    });
  }, [query]);

  const preview = useMemo(
    () => result ? JSON.stringify(result.rows, null, 2) : '',
    [result],
  );

  const isFiltered = Object.values(filters).some(v => v.trim());

  // ── Loading states ──
  if (status === 'idle')    return <div className="skeleton h-32 rounded-md" />;
  if (status === 'loading') return <StatusRow>Initialising DuckDB…</StatusRow>;
  if (status === 'error')   return <StatusRow error>{error}</StatusRow>;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Text variant="muted">Preview</Text>
        <Badge variant="count" color="dim">
          {isFiltered && result
            ? `${result.filteredCount.toLocaleString()} / ${totalRows.toLocaleString()}`
            : totalRows.toLocaleString()
          } rows
        </Badge>
        {result && result.rows.length === 1000 && (
          <Badge variant="count" color="dim">showing first 1 000</Badge>
        )}
      </div>

      {/* Schema-driven filter inputs */}
      <div className="flex flex-col gap-1">
        {columns.map(col => (
          <div key={col.name} className="flex items-baseline gap-2">
            <Text variant="dim" className="shrink-0 w-40 truncate font-mono text-fg-3">
              {col.name}
              <span className="text-fg-4 text-[0.7rem] ml-1">{col.type}</span>
            </Text>
            <input
              className={input({ variant: 'surface', size: 'sm' })}
              style={{ flex: 1 }}
              placeholder={`e.g. ${col.name} = 'value'`}
              value={filters[col.name] ?? ''}
              onChange={e => handleFilterChange(col.name, e.target.value)}
              spellCheck={false}
            />
          </div>
        ))}
      </div>

      {queryError && (
        <Text variant="dim" className="text-red font-mono text-sm">{queryError}</Text>
      )}

      {/* Results */}
      <div
        className="overflow-auto rounded-md border border-line"
        style={{ background: 'var(--color-void)', maxHeight: 400 }}
      >
        <pre className="font-mono text-body text-fg-2 p-2 m-0 leading-relaxed">
          <code>{preview}</code>
        </pre>
      </div>
    </div>
  );
}

function StatusRow({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 py-2">
      {!error && <div className="size-3 rounded-full border border-cyan border-t-transparent animate-spin shrink-0" />}
      <Text variant="dim" className={error ? 'text-red' : ''}>{children}</Text>
    </div>
  );
}

// ── Plain text preview with infinite scroll ──────────────

interface TextPreviewProps {
  pages:              FilePreviewPage[];
  isFetchingNextPage: boolean;
  hasNextPage:        boolean;
  fetchNextPage:      () => void;
}

function TextPreview({ pages, isFetchingNextPage, hasNextPage, fetchNextPage }: TextPreviewProps) {
  const scrollRef   = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const onIntersect = useCallback(
    ([entry]: IntersectionObserverEntry[]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroll   = scrollRef.current;
    if (!sentinel || !scroll) return;
    const observer = new IntersectionObserver(onIntersect, { root: scroll, rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onIntersect]);

  const allLines = pages.flatMap(p => p.lines);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Text variant="muted">Preview</Text>
        {hasNextPage && <Badge variant="count" color="dim">{allLines.length} lines</Badge>}
      </div>
      <div
        ref={scrollRef}
        className="overflow-auto rounded-md border border-line"
        style={{ background: 'var(--color-void)', maxHeight: 400 }}
      >
        <pre className="font-mono text-body text-fg-2 p-2 m-0 leading-relaxed">
          <code>{allLines.join('\n')}</code>
        </pre>
        <div ref={sentinelRef} style={{ height: 1 }} />
        {isFetchingNextPage && (
          <div className="px-2 pb-2 flex flex-col gap-1">
            <div className="skeleton h-3.5 rounded" style={{ width: '70%' }} />
            <div className="skeleton h-3.5 rounded" style={{ width: '50%' }} />
            <div className="skeleton h-3.5 rounded" style={{ width: '60%' }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main preview component ───────────────────────────────

export default function FilePreview({ fileId, filename }: FilePreviewProps) {
  const isJson = filename.toLowerCase().endsWith('.json');

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteFilePreview(!isJson ? fileId : undefined);

  if (isJson) {
    return <JsonDuckDbPreview fileId={fileId} />;
  }

  if (isLoading) return <div className="skeleton h-32 rounded-md" />;

  const firstPage = data?.pages[0];
  if (!firstPage?.previewable || !firstPage.lines.length) return null;

  return (
    <TextPreview
      pages={data!.pages}
      isFetchingNextPage={isFetchingNextPage}
      hasNextPage={!!hasNextPage}
      fetchNextPage={fetchNextPage}
    />
  );
}

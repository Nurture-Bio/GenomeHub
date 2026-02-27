import { useRef, useEffect, useCallback, useState } from 'react';
import { useInfiniteFilePreview } from '../hooks/useGenomicQueries';
import type { FilePreviewPage } from '../hooks/useGenomicQueries';
import { usePresignedUrl } from '../hooks/useGenomicQueries';
import { useJsonDuckDb } from '../hooks/useJsonDuckDb';
import { isNumericType } from '../hooks/useJsonDuckDb';
import type { SortSpec } from '../hooks/useJsonDuckDb';
import DataTable from './DataTable';
import { Text, Badge } from '../ui';

interface FilePreviewProps {
  fileId:   string;
  filename: string;
}

// ── Filter expression builder ────────────────────────────

function buildFilterExpression(raw: string, colType: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Already has a SQL operator prefix — pass through (power-user)
  if (/^(=|!=|<>|>=?|<=?|BETWEEN|LIKE|ILIKE|NOT|IN\s*\()/i.test(trimmed)) {
    return trimmed;
  }

  // Boolean select already emits "= true" / "= false"
  if (colType.toUpperCase() === 'BOOLEAN') return trimmed;

  // Numeric range slider already emits "BETWEEN x AND y"
  if (isNumericType(colType)) return trimmed;

  // Default for strings: case-insensitive LIKE
  return `ILIKE '%${trimmed.replace(/'/g, "''")}%'`;
}

// ── DuckDB JSON preview ──────────────────────────────────

function JsonDuckDbPreview({ fileId }: { fileId: string }) {
  const { getUrl }                  = usePresignedUrl();
  const [filters, setFilters]       = useState<Record<string, string>>({});
  const [sort, setSort]             = useState<SortSpec | null>(null);
  const [result, setResult]         = useState<{ rows: Record<string, unknown>[]; filteredCount: number; error?: string } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef                  = useRef<Record<string, string>>({});
  const sortRef                     = useRef<SortSpec | null>(null);

  const getFileUrl = useCallback(() => getUrl(fileId), [getUrl, fileId]);
  const { status, columns, totalRows, columnStats, columnCardinality, error, query } = useJsonDuckDb(fileId, getFileUrl);

  // Run initial query once table is ready
  useEffect(() => {
    if (status === 'ready') {
      setIsQuerying(true);
      query({ filters: {} }).then(r => {
        if (r) { setResult(r); setQueryError(r.error ?? null); }
        setIsQuerying(false);
      });
    }
  }, [status, query]);

  // Build SQL filter map from raw inputs
  const buildSqlFilters = useCallback((raw: Record<string, string>): Record<string, string> => {
    const sql: Record<string, string> = {};
    for (const [path, value] of Object.entries(raw)) {
      if (!value.trim()) continue;
      // Find the column type for this path
      const col = columns.find(c => c.name === path)
        ?? columns.find(c => path.startsWith(c.name + '.'));
      const colType = col?.type ?? 'VARCHAR';
      // For struct sub-fields, use the sub-field type if we can find it
      let effectiveType = colType;
      if (path.includes('.') && colType.startsWith('STRUCT(')) {
        const field = path.split('.').pop()!;
        const match = colType.match(new RegExp(`"?${field}"?\\s+(\\S+)`));
        if (match) effectiveType = match[1].replace(/[,)]/g, '');
      }
      sql[path] = buildFilterExpression(value, effectiveType);
    }
    return sql;
  }, [columns]);

  const runQueryDebounced = useCallback((rawFilters: Record<string, string>, currentSort: SortSpec | null) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setIsQuerying(true);
      const sqlFilters = buildSqlFilters(rawFilters);
      query({ filters: sqlFilters, sort: currentSort }).then(r => {
        if (!r) return;
        if (r.error) { setQueryError(r.error); }
        else { setResult(r); setQueryError(null); }
        setIsQuerying(false);
      });
    }, 300);
  }, [query, buildSqlFilters]);

  const runQueryImmediate = useCallback((rawFilters: Record<string, string>, currentSort: SortSpec | null) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsQuerying(true);
    const sqlFilters = buildSqlFilters(rawFilters);
    query({ filters: sqlFilters, sort: currentSort }).then(r => {
      if (!r) return;
      if (r.error) { setQueryError(r.error); }
      else { setResult(r); setQueryError(null); }
      setIsQuerying(false);
    });
  }, [query, buildSqlFilters]);

  // Cleanup debounce on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleFilterChange = useCallback((path: string, val: string) => {
    const next = { ...filtersRef.current, [path]: val };
    filtersRef.current = next;
    setFilters(next);
    runQueryDebounced(next, sortRef.current);
  }, [runQueryDebounced]);

  const handleSortChange = useCallback((newSort: SortSpec | null) => {
    sortRef.current = newSort;
    setSort(newSort);
    runQueryImmediate(filtersRef.current, newSort);
  }, [runQueryImmediate]);

  const isFiltered = Object.values(filters).some(v => v.trim());

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
        {result && result.filteredCount > 1000 && (
          <Badge variant="count" color="dim">first 1 000</Badge>
        )}
      </div>

      {queryError && (
        <Text variant="dim" className="font-mono" style={{ color: 'var(--color-red)', fontSize: '0.75rem' }}>
          {queryError}
        </Text>
      )}

      {/* Data table */}
      <DataTable
        columns={columns}
        columnStats={columnStats}
        columnCardinality={columnCardinality}
        rows={result?.rows ?? []}
        totalRows={totalRows}
        filteredCount={result?.filteredCount ?? 0}
        isQuerying={isQuerying}
        error={queryError}
        filters={filters}
        onFilterChange={handleFilterChange}
        sort={sort}
        onSortChange={handleSortChange}
      />
    </div>
  );
}

function StatusRow({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      {!error && (
        <div className="h-1.5 w-[60%] rounded-full overflow-hidden" style={{ background: 'var(--color-raised)' }}>
          <div className="h-full w-full progress-stripe" style={{ background: 'var(--color-cyan)' }} />
        </div>
      )}
      <Text variant="dim" style={error ? { color: 'var(--color-red)' } : undefined}>{children}</Text>
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
            <div className="skeleton h-[1lh] rounded" style={{ width: '70%' }} />
            <div className="skeleton h-[1lh] rounded" style={{ width: '50%' }} />
            <div className="skeleton h-[1lh] rounded" style={{ width: '60%' }} />
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

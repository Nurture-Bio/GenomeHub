import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useInfiniteFilePreview } from '../hooks/useGenomicQueries';
import type { FilePreviewPage } from '../hooks/useGenomicQueries';
import { usePresignedUrl } from '../hooks/useGenomicQueries';
import { useJsonDuckDb } from '../hooks/useJsonDuckDb';
import type { ColumnInfo } from '../hooks/useJsonDuckDb';
import { Text, Badge } from '../ui';
import { input } from '../ui/recipes';

interface FilePreviewProps {
  fileId:   string;
  filename: string;
}

// ── STRUCT field expansion ───────────────────────────────
// Parse "STRUCT(field1 TYPE1, "field2" TYPE2, ...)" into flat filter rows.
// Depth-aware split handles nested types without regex hacks.

function parseStructFields(typeStr: string): ColumnInfo[] {
  const inner = typeStr.match(/^STRUCT\((.+)\)$/s)?.[1];
  if (!inner) return [];

  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());

  return parts.flatMap(part => {
    const m = part.match(/^"?(\w+)"?\s+(.+)$/);
    return m ? [{ name: m[1], type: m[2] }] : [];
  });
}

// Expand top-level columns: STRUCT → sub-fields with "parent.field" paths.
// Non-STRUCT columns pass through as-is.
interface FilterRow {
  path:       string;   // SQL path: "chrom" or "tags.off_targets"
  label:      string;   // Display name
  type:       string;   // DuckDB type (short)
  placeholder: string;
}

function buildFilterRows(columns: ColumnInfo[]): FilterRow[] {
  const rows: FilterRow[] = [];
  for (const col of columns) {
    if (col.type.startsWith('STRUCT(')) {
      const sub = parseStructFields(col.type);
      for (const f of sub) {
        rows.push({
          path:        `${col.name}.${f.name}`,
          label:       `${col.name}.${f.name}`,
          type:        f.type,
          placeholder: `${col.name}.${f.name} = …`,
        });
      }
    } else {
      rows.push({
        path:        col.name,
        label:       col.name,
        type:        col.type,
        placeholder: `${col.name} = …`,
      });
    }
  }
  return rows;
}

// ── DuckDB JSON preview ──────────────────────────────────

function JsonDuckDbPreview({ fileId }: { fileId: string }) {
  const { getUrl }                  = usePresignedUrl();
  const [filters, setFilters]       = useState<Record<string, string>>({});
  const [result, setResult]         = useState<{ rows: Record<string, unknown>[]; filteredCount: number; error?: string } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef                  = useRef<Record<string, string>>({});

  const getFileUrl = useCallback(() => getUrl(fileId), [getUrl, fileId]);
  const { status, columns, totalRows, error, query } = useJsonDuckDb(fileId, getFileUrl);

  const filterRows = useMemo(() => buildFilterRows(columns), [columns]);

  // Run initial query once table is ready
  useEffect(() => {
    if (status === 'ready') {
      query({}).then(r => { if (r) setResult(r); });
    }
  }, [status, query]);

  const runQuery = useCallback((next: Record<string, string>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      query(next).then(r => {
        if (!r) return;
        if (r.error) setQueryError(r.error);
        else { setResult(r); setQueryError(null); }
      });
    }, 300);
  }, [query]);

  // Debounce cleanup on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleFilterChange = useCallback((path: string, val: string) => {
    const next = { ...filtersRef.current, [path]: val };
    filtersRef.current = next;
    setFilters(next);
    runQuery(next);
  }, [runQuery]);

  const preview = useMemo(
    () => result ? JSON.stringify(result.rows, null, 2) : '',
    [result],
  );

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

      {/* Schema-driven filter grid */}
      <div
        className="grid gap-x-3 gap-y-0.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {filterRows.map(row => (
          <div key={row.path} className="flex flex-col gap-0.5">
            <span className="font-mono leading-none" style={{ fontSize: '0.65rem', color: 'var(--color-fg-3)' }}>
              {row.label}
              <span style={{ color: 'var(--color-fg-4)', marginLeft: 4 }}>{row.type}</span>
            </span>
            <input
              className={input({ variant: 'surface', size: 'sm' })}
              placeholder={row.placeholder}
              value={filters[row.path] ?? ''}
              onChange={e => handleFilterChange(row.path, e.target.value)}
              spellCheck={false}
            />
          </div>
        ))}
      </div>

      {queryError && (
        <Text variant="dim" className="font-mono" style={{ color: 'var(--color-red)', fontSize: '0.75rem' }}>
          {queryError}
        </Text>
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

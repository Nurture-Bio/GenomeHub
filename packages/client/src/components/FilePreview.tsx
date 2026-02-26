import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useInfiniteFilePreview } from '../hooks/useGenomicQueries';
import type { FilePreviewPage } from '../hooks/useGenomicQueries';
import { Text, Badge, FilterChip } from '../ui';

interface FilePreviewProps {
  fileId: string;
  filename: string;
}

// ── JSON record filter helpers ───────────────────────────

type AnyRecord = Record<string, unknown>;

function getField(record: AnyRecord, path: string): unknown {
  const dot = path.indexOf('.');
  if (dot === -1) return record[path];
  const head = path.slice(0, dot);
  const tail  = path.slice(dot + 1);
  const nested = record[head];
  if (nested == null || typeof nested !== 'object' || Array.isArray(nested)) return undefined;
  return getField(nested as AnyRecord, tail);
}

interface FilterableField {
  path:   string;
  label:  string;
  values: string[];
}

function buildFilterableFields(records: AnyRecord[]): FilterableField[] {
  if (!records.length) return [];
  const paths: string[] = [];

  for (const [key, val] of Object.entries(records[0])) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      for (const sub of Object.keys(val as AnyRecord)) paths.push(`${key}.${sub}`);
    } else {
      paths.push(key);
    }
  }

  const result: FilterableField[] = [];
  for (const path of paths) {
    const raw = records.map(r => {
      const v = getField(r, path);
      return v == null ? null : String(v);
    });
    const unique = [...new Set(raw.filter((v): v is string => v !== null))].sort();
    if (unique.length < 2 || unique.length > 15) continue;
    const label = path.split('.').pop()!;
    result.push({ path, label, values: unique });
  }
  return result;
}

// ── JSON array preview with filters ─────────────────────

function JsonArrayPreview({ records, truncated }: { records: AnyRecord[]; truncated: boolean }) {
  const fields = useMemo(() => buildFilterableFields(records), [records]);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const filtered = useMemo(() =>
    records.filter(r =>
      Object.entries(filters).every(([path, val]) => {
        if (!val) return true;
        const v = getField(r, path);
        return v != null && String(v) === val;
      })
    ),
    [records, filters],
  );

  const preview = useMemo(() => JSON.stringify(filtered, null, 2), [filtered]);
  const activeFilters = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Text variant="muted">Preview</Text>
        <Badge variant="count" color="dim">
          {activeFilters > 0 ? `${filtered.length} / ${records.length}` : records.length} records
          {truncated ? ' · first 128 KB' : ''}
        </Badge>
      </div>

      {fields.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {fields.map(f => (
            <FilterChip
              key={f.path}
              label={`Any ${f.label}`}
              items={f.values.map(v => ({ id: v, label: v }))}
              value={filters[f.path] ?? ''}
              onValueChange={v => setFilters(prev => ({ ...prev, [f.path]: v }))}
            />
          ))}
        </div>
      )}

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

// ── Plain text preview with infinite scroll ──────────────

interface TextPreviewProps {
  pages:             FilePreviewPage[];
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

export default function FilePreview({ fileId }: FilePreviewProps) {
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteFilePreview(fileId);

  if (isLoading) return <div className="skeleton h-32 rounded-md" />;

  const firstPage = data?.pages[0];
  if (!firstPage?.previewable) return null;

  if (firstPage.records) {
    return <JsonArrayPreview records={firstPage.records} truncated={firstPage.truncated} />;
  }

  if (!firstPage.lines.length) return null;
  return (
    <TextPreview
      pages={data!.pages}
      isFetchingNextPage={isFetchingNextPage}
      hasNextPage={!!hasNextPage}
      fetchNextPage={fetchNextPage}
    />
  );
}

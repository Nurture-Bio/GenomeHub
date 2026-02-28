/**
 * Legacy DuckDB-backed JSON preview.
 *
 * Preserved as a working fallback while the Strand-First pipeline is stabilised.
 * Do NOT modify this file — it is the reference implementation.
 *
 * Usage:
 *   import JsonDuckDbPreview from '../legacy/JsonDuckDbPreview';
 *   <JsonDuckDbPreview fileId={fileId} />
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { usePresignedUrl } from '../hooks/useGenomicQueries';
import { useJsonDuckDb, isNumericType } from '../hooks/useJsonDuckDb';
import type { SortSpec, DuckDbStage } from '../hooks/useJsonDuckDb';
import DataTable from '../components/DataTable';
import { Text, Badge } from '../ui';

// ── Filter expression builder ─────────────────────────────────────────────────

function buildFilterExpression(raw: string, colType: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (/^(=|!=|<>|>=?|<=?|BETWEEN|LIKE|ILIKE|NOT|IN\s*\()/i.test(trimmed)) {
    return trimmed;
  }

  if (colType.toUpperCase() === 'BOOLEAN') return trimmed;
  if (isNumericType(colType)) return trimmed;

  return `ILIKE '%${trimmed.replace(/'/g, "''")}%'`;
}

// ── DuckDB JSON preview ───────────────────────────────────────────────────────

export default function JsonDuckDbPreview({ fileId }: { fileId: string }) {
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
  const { status, stage, columns, totalRows, columnStats, columnCardinality, error, query } = useJsonDuckDb(fileId, getFileUrl);

  useEffect(() => {
    if (status === 'ready') {
      setIsQuerying(true);
      query({ filters: {} }).then(r => {
        if (r) { setResult(r); setQueryError(r.error ?? null); }
        setIsQuerying(false);
      });
    }
  }, [status, query]);

  const buildSqlFilters = useCallback((raw: Record<string, string>): Record<string, string> => {
    const sql: Record<string, string> = {};
    for (const [path, value] of Object.entries(raw)) {
      if (!value.trim()) continue;
      const col = columns.find(c => c.name === path)
        ?? columns.find(c => path.startsWith(c.name + '.'));
      const colType = col?.type ?? 'VARCHAR';
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

  if (status === 'error')   return <StatusRow error>{error}</StatusRow>;
  if (status !== 'ready')   return <SteppedProgress stage={stage} />;

  return (
    <div className="flex flex-col gap-1.5">
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

// ── Loading / error helpers ───────────────────────────────────────────────────

const STAGES: { key: DuckDbStage; label: string }[] = [
  { key: 'initializing', label: 'Initializing engine' },
  { key: 'loading-json', label: 'Loading JSON' },
  { key: 'analyzing',    label: 'Analyzing schema' },
  { key: 'statistics',   label: 'Computing statistics' },
  { key: 'ready',        label: 'Ready' },
];

function SteppedProgress({ stage }: { stage: DuckDbStage }) {
  const currentIdx = STAGES.findIndex(s => s.key === stage);
  return (
    <div className="flex flex-col gap-1 py-2">
      {STAGES.map((s, i) => {
        const done   = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.key} className="flex items-center gap-2 font-mono"
            style={{
              fontSize: 'var(--font-size-xs)',
              color: done ? 'var(--color-cyan)' : active ? 'var(--color-fg)' : 'var(--color-fg-3)',
              transition: 'color 0.2s',
            }}
          >
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: done ? 'var(--color-cyan)' : active ? 'var(--color-cyan)' : 'var(--color-line)',
              opacity: active ? 1 : done ? 0.7 : 0.3,
              boxShadow: active ? '0 0 6px var(--color-cyan)' : 'none',
              transition: 'all 0.2s',
            }} />
            {s.label}
          </div>
        );
      })}
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

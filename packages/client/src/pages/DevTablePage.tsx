import { useRef, useMemo, useState, useCallback, useEffect, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as Popover from '@radix-ui/react-popover';
import { Heading, Text, Badge } from '../ui';
import { useStrandTable } from '../hooks/useStrandTable';
import { isNumericType, FACET_MAX, DROPDOWN_MAX } from '../hooks/useJsonDuckDb';
import type { ColumnStats } from '../hooks/useJsonDuckDb';
import type { StrandColumnMeta } from '../strand/schema';
import type { RecordCursor } from '@strand/core';

/**
 * Dev-only page: strand-backed virtual DataTable PoC.
 * No server, no DuckDB, no auth. Just `npm run dev` and open /dev/table.
 */

// ── Field reading (duplicated from hook for render perf) ─

function readField(cursor: RecordCursor, col: StrandColumnMeta): unknown {
  switch (col.strandType) {
    case 'i32':      return cursor.getI32(col.field);
    case 'f64':      return cursor.getF64(col.field);
    case 'utf8':     return cursor.getString(col.field);
    case 'utf8_ref': return cursor.getRef(col.field);
    default:         return cursor.get(col.field);
  }
}

// ── Formatting ───────────────────────────────────────────

function isIntegerType(type: string): boolean {
  return type === 'INTEGER' || type === 'BIGINT' || type === 'INT';
}

function formatCompact(n: number, colType: string): string {
  const int = isIntegerType(colType);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return Math.round(n / 1_000_000_000) + 'B';
  if (abs >= 1_000_000)     return Math.round(n / 1_000_000) + 'M';
  if (abs >= 10_000)        return Math.round(n / 1_000) + 'K';
  if (int || Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

function formatCell(value: unknown, duckType: string): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-fg-3 italic">null</span>;
  }
  const numeric = isNumericType(duckType);
  if (numeric && typeof value === 'number') {
    return <span title={value.toLocaleString()}>{formatCompact(value, duckType)}</span>;
  }
  const str = String(value);
  if (str.length > 60) return <span title={str}>{str.slice(0, 57)}…</span>;
  return <span>{str}</span>;
}

function heatmapStyle(value: number, min: number, max: number): React.CSSProperties {
  if (min === max) return {};
  const t = (value - min) / (max - min);
  return { background: `oklch(0.750 0.180 195 / ${(t * 0.12).toFixed(3)})` };
}

// ── Type badges ──────────────────────────────────────────

const TYPE_BADGES: Record<string, { bg: string; label: string }> = {
  VARCHAR:  { bg: 'oklch(0.600 0.100 140 / 0.25)', label: 'STR' },
  INTEGER:  { bg: 'oklch(0.700 0.150 195 / 0.25)', label: 'INT' },
  DOUBLE:   { bg: 'oklch(0.700 0.120 80 / 0.25)',  label: 'DEC' },
};

function getTypeBadge(type: string): { bg: string; label: string } {
  return TYPE_BADGES[type] ?? { bg: 'oklch(0.500 0.060 250 / 0.25)', label: type.slice(0, 4).toUpperCase() };
}

// ── Column width helper ──────────────────────────────────

function defaultWidth(type: string): number {
  if (isNumericType(type)) return 85;
  return 130;
}

// ── Sort chevron ─────────────────────────────────────────

function SortChevron({ direction }: { direction: 'asc' | 'desc' | null }) {
  return (
    <svg
      width="8" height="5" viewBox="0 0 8 5" fill="currentColor"
      style={{
        transition: 'transform var(--t-fast) var(--ease-move), opacity var(--t-fast)',
        transform: direction === 'desc' ? 'rotate(180deg)' : 'none',
        opacity: direction ? 1 : 0.3,
        color: direction ? 'var(--color-cyan)' : 'inherit',
        flexShrink: 0,
      }}
    >
      <path d="M4 0L7.5 4.5H0.5L4 0Z" />
    </svg>
  );
}

// ── Range slider ─────────────────────────────────────────

function RangeSlider({
  min, max, low, high, onRangeChange, path, colType,
}: {
  min: number; max: number; low: number; high: number;
  onRangeChange: (path: string, low: number, high: number) => void;
  path: string; colType: string;
}) {
  const intCol = isIntegerType(colType);
  const step = intCol ? Math.max(1, Math.round((max - min) / 200)) : ((max - min) / 200 || 1);
  const range = max - min || 1;
  const lowPct = ((low - min) / range) * 100;
  const highPct = ((high - min) / range) * 100;
  const isFullRange = low <= min && high >= max;

  const coerce = (v: number) => intCol ? Math.round(v) : v;

  return (
    <div className="flex flex-col gap-0" style={{ minWidth: 80 }}>
      <div className="relative" style={{ height: 22 }}>
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full w-full" style={{ height: 2, background: 'var(--color-line)' }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%`, height: 2, background: 'var(--color-cyan)', opacity: isFullRange ? 0.3 : 1 }}
        />
        <input
          type="range" className="range-thumb range-low absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min} max={max} step={step} value={low}
          onChange={e => onRangeChange(path, Math.min(coerce(Number(e.target.value)), high), high)}
          style={{ zIndex: 3 }}
        />
        <input
          type="range" className="range-thumb range-high absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min} max={max} step={step} value={high}
          onChange={e => onRangeChange(path, low, Math.max(coerce(Number(e.target.value)), low))}
          style={{ zIndex: 4 }}
        />
      </div>
      <div className="flex justify-between" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-mono)', color: isFullRange ? 'var(--color-fg-3)' : 'var(--color-fg-2)' }}>
        <span>{formatCompact(coerce(low), colType)}</span>
        <span>{formatCompact(coerce(high), colType)}</span>
      </div>
    </div>
  );
}

// ── Display helpers ──────────────────────────────────────

function displayValue(v: string): string {
  return v === '' || v === 'null' || v === 'undefined' ? '(empty)' : v;
}

// ── Facet select (reused from DataTable pattern) ─────────

function FacetSelect({
  label, values, active, onSelect,
}: {
  label: string; values: string[]; active: string; onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 font-mono cursor-pointer bg-transparent hover:bg-raised transition-colors"
          style={{ fontSize: 'var(--font-size-xs)' }}
          data-active={!!active || undefined}
        >
          <span className="text-fg-2">{label}</span>
          {active && <span className="text-cyan font-semibold">{displayValue(active)}</span>}
          <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0 opacity-50">
            <path d="M2 3l2 2 2-2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={4} align="start" className="bg-base border border-line shadow-lg rounded-md overflow-auto z-popover animate-fade-in" style={{ maxHeight: 240 }}>
          {active && (
            <button
              className="block text-left px-2 py-1 text-fg-2 font-mono cursor-pointer bg-transparent border-none hover:bg-raised transition-colors whitespace-nowrap"
              style={{ fontSize: 'var(--font-size-xs)', borderBottom: '1px solid var(--color-line)' }}
              onClick={() => { onSelect(''); setOpen(false); }}
            >Clear</button>
          )}
          {values.map(v => (
            <button
              key={v}
              className="block text-left px-2 py-1 font-mono cursor-pointer bg-transparent border-none hover:bg-raised transition-colors whitespace-nowrap"
              style={{
                fontSize: 'var(--font-size-xs)',
                color: v === active ? 'var(--color-cyan)' : 'var(--color-fg)',
                fontWeight: v === active ? 600 : 400,
                fontStyle: (v === '' || v === 'null' || v === 'undefined') ? 'italic' : undefined,
              }}
              onClick={() => { onSelect(v === active ? '' : v); setOpen(false); }}
            >{displayValue(v)}</button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Memoized virtual rows (avoids re-render on filter/slider state changes) ──

const ROW_HEIGHT = 28;

const VirtualRows = memo(function VirtualRows({
  scrollRef, filteredIndices, cursor, tableColumns, columnStats, colWidths, totalWidth,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  filteredIndices: number[];
  cursor: RecordCursor;
  tableColumns: StrandColumnMeta[];
  columnStats: Record<string, ColumnStats>;
  colWidths: Record<string, number>;
  totalWidth: number;
}) {
  const virtualizer = useVirtualizer({
    count: filteredIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 50,
  });

  return (
    <>
      {/* Spacer inside table for total height */}
      <table className="border-collapse font-mono text-xs" style={{ width: totalWidth }}>
        <tbody>
          <tr style={{ height: virtualizer.getTotalSize() }}>
            <td style={{ padding: 0, border: 'none' }} />
          </tr>
        </tbody>
      </table>

      {/* Absolutely positioned virtual rows */}
      <div
        style={{
          position: 'relative',
          width: totalWidth,
          marginTop: -virtualizer.getTotalSize(),
        }}
      >
        {virtualizer.getVirtualItems().map(vRow => {
          const seq = filteredIndices[vRow.index];
          cursor.seek(seq);

          return (
            <div
              key={vRow.key}
              className="flex hover:brightness-110"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${vRow.start}px)`,
                background: vRow.index % 2 === 1 ? 'var(--color-row-stripe)' : undefined,
              }}
            >
              {tableColumns.map(col => {
                const val = readField(cursor, col);
                const numeric = isNumericType(col.duckType);
                const stats = numeric ? columnStats[col.path] : undefined;
                const numVal = numeric ? Number(val) : NaN;
                const w = colWidths[col.path] ?? defaultWidth(col.duckType);

                let cellStyle: React.CSSProperties = {
                  width: w,
                  minWidth: 60,
                  borderBottom: '1px solid var(--color-line)',
                  padding: '2px 6px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                };
                if (numeric && stats && !isNaN(numVal)) {
                  cellStyle = { ...cellStyle, ...heatmapStyle(numVal, stats.min, stats.max) };
                }

                return (
                  <div
                    key={col.field}
                    className="dt-heat"
                    style={{
                      ...cellStyle,
                      textAlign: numeric ? 'right' : 'left',
                      fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                      lineHeight: `${ROW_HEIGHT}px`,
                      fontSize: 'var(--font-size-xs)',
                    }}
                  >
                    {formatCell(val, col.duckType)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
});

// ── Component ────────────────────────────────────────────

export default function DevTablePage() {
  const {
    status, totalRecords, filteredCount, columns, columnStats, columnCardinality,
    filteredIndices, cursor, filters, sort, onFilterChange, onSortChange, error,
  } = useStrandTable();

  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [rangeState, setRangeState] = useState<Record<string, [number, number]>>({});
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const rangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Split columns into facets vs table
  const { facetColumns, tableColumns } = useMemo(() => {
    const facets: StrandColumnMeta[] = [];
    const table: StrandColumnMeta[] = [];
    for (const col of columns) {
      const card = columnCardinality[col.path];
      if (card && card.distinct >= 1 && card.distinct <= FACET_MAX) {
        facets.push(col);
      } else {
        table.push(col);
      }
    }
    return { facetColumns: facets, tableColumns: table };
  }, [columns, columnCardinality]);

  // Resize handlers
  const handleResizeStart = useCallback((col: string, startX: number, currentWidth: number) => {
    resizingRef.current = { col, startX, startW: currentWidth };
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = e.clientX - resizingRef.current.startX;
      const newW = Math.max(60, resizingRef.current.startW + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Sort click: null → asc → desc → null
  const handleSortClick = useCallback((colPath: string) => {
    if (!sort || sort.column !== colPath) {
      onSortChange({ column: colPath, direction: 'asc' });
    } else if (sort.direction === 'asc') {
      onSortChange({ column: colPath, direction: 'desc' });
    } else {
      onSortChange(null);
    }
  }, [sort, onSortChange]);

  // Range filter
  const handleRangeChange = useCallback((path: string, low: number, high: number) => {
    const stats = columnStats[path];
    setRangeState(prev => ({ ...prev, [path]: [low, high] }));
    if (!stats) return;
    if (rangeDebounceRef.current) clearTimeout(rangeDebounceRef.current);
    rangeDebounceRef.current = setTimeout(() => {
      if (low <= stats.min && high >= stats.max) {
        onFilterChange(path, '');
      } else {
        onFilterChange(path, `BETWEEN ${low} AND ${high}`);
      }
    }, 120);
  }, [columnStats, onFilterChange]);

  useEffect(() => () => { if (rangeDebounceRef.current) clearTimeout(rangeDebounceRef.current); }, []);

  // Init range state from stats
  useEffect(() => {
    const initial: Record<string, [number, number]> = {};
    for (const col of columns) {
      if (!isNumericType(col.duckType)) continue;
      const stats = columnStats[col.path];
      if (stats && !rangeState[col.path]) {
        initial[col.path] = [stats.min, stats.max];
      }
    }
    if (Object.keys(initial).length > 0) {
      setRangeState(prev => ({ ...initial, ...prev }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, columnStats]);

  // Filter value extractors
  const activeFilterValue = useCallback((path: string): string => {
    const raw = filters[path] ?? '';
    const m = raw.match(/^= '(.+)'$/);
    return m ? m[1] : '';
  }, [filters]);

  const handleSelectFilter = useCallback((path: string, value: string) => {
    onFilterChange(path, value ? `= '${value}'` : '');
  }, [onFilterChange]);

  const isFiltered = Object.values(filters).some(v => v.trim());
  const totalWidth = tableColumns.reduce((sum, col) => sum + (colWidths[col.path] ?? defaultWidth(col.duckType)), 0);

  // Error state
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center" style={{ background: 'var(--color-void)', height: 'calc(100dvh - 2.5rem)' }}>
        <Text variant="dim">Error: {error}</Text>
      </div>
    );
  }

  // Init state (before first batch)
  if (status === 'init') {
    return (
      <div className="flex flex-col items-center justify-center" style={{ background: 'var(--color-void)', height: 'calc(100dvh - 2.5rem)' }}>
        <Text variant="dim">Initializing strand…</Text>
      </div>
    );
  }

  const isStreaming = status === 'streaming';

  return (
    <div className="flex flex-col" style={{ background: 'var(--color-void)', height: 'calc(100dvh - 2.5rem)' }}>
      <div className="px-4 py-3 border-b border-line flex items-center gap-3" style={{ background: 'var(--color-base)' }}>
        <Heading as="span" level="subheading">DataTable Dev</Heading>
        <Text variant="dim">
          {totalRecords.toLocaleString()} mock CRISPR guides
          {isStreaming && '…'}
        </Text>
        <Badge variant="count" color="dim">strand</Badge>
        {isStreaming && <Badge variant="count" color="dim">streaming</Badge>}
      </div>

      <div className="flex-1 overflow-hidden p-4 flex flex-col gap-2">
        {/* Status bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Text variant="muted">Preview</Text>
          <Badge variant="count" color="dim">
            {isFiltered
              ? `${filteredCount.toLocaleString()} / ${totalRecords.toLocaleString()}`
              : totalRecords.toLocaleString()
            } rows
          </Badge>
          <Badge variant="count" color="dim">virtual</Badge>
        </div>

        {/* Facet bar */}
        {facetColumns.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {facetColumns.map(col => {
              const card = columnCardinality[col.path];
              const isConstant = card?.distinct === 1;

              if (isConstant) {
                return (
                  <span
                    key={col.path}
                    className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono"
                    style={{ fontSize: 'var(--font-size-xs)', background: 'oklch(0.700 0.150 195 / 0.15)', border: '1px solid oklch(0.700 0.150 195 / 0.25)' }}
                  >
                    <span className="text-fg-2">{col.label}</span>
                    <span style={{ color: 'var(--color-cyan)', fontWeight: 600 }}>{displayValue(card!.values[0])}</span>
                  </span>
                );
              }

              const values = card?.values ?? [];
              const active = activeFilterValue(col.path);

              return (
                <FacetSelect
                  key={col.path}
                  label={col.label}
                  values={values}
                  active={active}
                  onSelect={v => handleSelectFilter(col.path, v)}
                />
              );
            })}
          </div>
        )}

        {/* Virtual table */}
        <div
          className="flex-1 flex flex-col overflow-hidden rounded-md border border-line"
          style={{ background: 'var(--color-void)' }}
        >
          {/* Pinned header (outside scroll) */}
          <div ref={headerRef} className="shrink-0 overflow-hidden font-mono text-xs" style={{ width: totalWidth }}>
            {/* Column labels row */}
            <div className="flex">
              {tableColumns.map(col => {
                const w = colWidths[col.path] ?? defaultWidth(col.duckType);
                const isColFiltered = !!(filters[col.path] && filters[col.path].trim());
                const sortDir = sort?.column === col.path ? sort.direction : null;
                const badge = getTypeBadge(col.duckType);

                return (
                  <div
                    key={col.path}
                    className="text-left font-semibold text-fg-2 select-none relative group"
                    style={{
                      width: w, minWidth: 60, flexShrink: 0,
                      padding: '2px 6px',
                      background: 'var(--color-raised)',
                      borderBottom: isColFiltered ? '2px solid var(--color-cyan)' : '2px solid var(--color-line)',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                    onClick={() => handleSortClick(col.path)}
                  >
                    <div className="flex flex-col gap-0">
                      <div className="flex items-center gap-1">
                        <span style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'normal' }}>{col.path.replace(/([._])/g, '$1\u200B')}</span>
                        <SortChevron direction={sortDir} />
                      </div>
                      <span
                        className="rounded-sm px-0.5 font-mono self-start"
                        style={{ fontSize: 'var(--font-size-xs)', background: badge.bg, color: 'var(--color-fg-2)', lineHeight: '1.4' }}
                      >{badge.label}</span>
                    </div>
                    {/* Resize handle */}
                    <div
                      className="absolute top-0 right-0 bottom-0 opacity-0 group-hover:opacity-100 hover:!opacity-100"
                      style={{ width: 3, cursor: 'col-resize', background: 'var(--color-line)', transition: 'opacity var(--t-fast), background var(--t-fast)' }}
                      onMouseDown={e => { e.stopPropagation(); handleResizeStart(col.path, e.clientX, w); }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-cyan)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--glow-cyan-sm)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-line)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Filter row */}
            <div className="flex">
              {tableColumns.map(col => {
                const numeric = isNumericType(col.duckType);
                const stats = columnStats[col.path];
                const w = colWidths[col.path] ?? defaultWidth(col.duckType);
                const card = columnCardinality[col.path];

                return (
                  <div
                    key={`filter-${col.path}`}
                    className="text-left font-normal"
                    style={{ width: w, minWidth: 60, flexShrink: 0, padding: '2px 4px', background: 'var(--color-base)', borderBottom: '1px solid var(--color-line)' }}
                  >
                    {numeric && stats ? (
                      <RangeSlider
                        min={stats.min} max={stats.max}
                        low={rangeState[col.path]?.[0] ?? stats.min}
                        high={rangeState[col.path]?.[1] ?? stats.max}
                        onRangeChange={handleRangeChange} path={col.path} colType={col.duckType}
                      />
                    ) : card && card.distinct > FACET_MAX && card.distinct <= DROPDOWN_MAX ? (
                      <FacetSelect
                        label="All" values={card.values}
                        active={activeFilterValue(col.path)}
                        onSelect={v => handleSelectFilter(col.path, v)}
                      />
                    ) : (
                      <input
                        className="w-full bg-transparent border-none text-fg-2 font-mono placeholder:text-fg-3 focus:outline-none"
                        style={{ fontSize: 'var(--font-size-xs)' }}
                        placeholder="Search…"
                        value={filters[col.path] ?? ''}
                        onChange={e => onFilterChange(col.path, e.target.value)}
                        spellCheck={false}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scrollable body (syncs horizontal scroll with pinned header) */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto"
            onScroll={() => {
              if (headerRef.current && scrollRef.current) {
                headerRef.current.scrollLeft = scrollRef.current.scrollLeft;
              }
            }}
          >
            {/* Virtual rows (memoized — skips re-render on slider/filter state) */}
            {cursor && (
              <VirtualRows
                scrollRef={scrollRef}
                filteredIndices={filteredIndices}
                cursor={cursor}
                tableColumns={tableColumns}
                columnStats={columnStats}
                colWidths={colWidths}
                totalWidth={totalWidth}
              />
            )}

            {/* Empty state */}
            {filteredIndices.length === 0 && status === 'ready' && (
              <div className="flex items-center justify-center py-6 text-fg-3 text-body">
                No rows match the current filters
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

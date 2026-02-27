import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { ColumnInfo, SortSpec, ColumnStats, ColumnCardinality } from '../hooks/useJsonDuckDb';
import { isNumericType, FACET_MAX, DROPDOWN_MAX } from '../hooks/useJsonDuckDb';
import * as Popover from '@radix-ui/react-popover';

// ── Props ────────────────────────────────────────────────

interface DataTableProps {
  columns:           ColumnInfo[];
  columnStats:       Record<string, ColumnStats>;
  columnCardinality: Record<string, ColumnCardinality>;
  rows:              Record<string, unknown>[];
  totalRows:         number;
  filteredCount:     number;
  isQuerying:        boolean;
  error?:            string | null;
  filters:           Record<string, string>;
  onFilterChange:    (path: string, value: string) => void;
  sort:              SortSpec | null;
  onSortChange:      (sort: SortSpec | null) => void;
}

// ── Helpers ──────────────────────────────────────────────

function getNestedValue(row: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let val: unknown = row;
  for (const p of parts) {
    if (val == null || typeof val !== 'object') return undefined;
    val = (val as Record<string, unknown>)[p];
  }
  return val;
}

function formatCompact(n: number, colType: string): string {
  if (isIntegerType(colType)) return n.toLocaleString();
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (abs >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 10_000)        return (n / 1_000).toFixed(1) + 'K';
  if (Number.isInteger(n))  return n.toLocaleString();
  return n.toFixed(2);
}

function isIntegerType(type: string): boolean {
  const t = type.toUpperCase();
  return t === 'INTEGER' || t === 'BIGINT' || t === 'TINYINT' || t === 'SMALLINT' || t === 'HUGEINT' || t === 'INT';
}

function heatmapStyle(value: number, min: number, max: number): React.CSSProperties {
  if (min === max) return {};
  const t = (value - min) / (max - min);
  return { background: `oklch(0.750 0.180 195 / ${(t * 0.12).toFixed(3)})` };
}

function isBooleanType(type: string): boolean {
  return type.toUpperCase() === 'BOOLEAN';
}

// ── Type badge colors ────────────────────────────────────

const TYPE_BADGES: Record<string, { bg: string; label: string }> = {
  VARCHAR:  { bg: 'oklch(0.600 0.100 140 / 0.25)', label: 'STR' },
  INTEGER:  { bg: 'oklch(0.700 0.150 195 / 0.25)', label: 'INT' },
  BIGINT:   { bg: 'oklch(0.700 0.150 195 / 0.25)', label: 'BIG' },
  DOUBLE:   { bg: 'oklch(0.700 0.120 80 / 0.25)',  label: 'DEC' },
  FLOAT:    { bg: 'oklch(0.700 0.120 80 / 0.25)',  label: 'FLT' },
  BOOLEAN:  { bg: 'oklch(0.650 0.120 300 / 0.25)', label: 'BOOL' },
  TINYINT:  { bg: 'oklch(0.700 0.150 195 / 0.25)', label: 'I8' },
  SMALLINT: { bg: 'oklch(0.700 0.150 195 / 0.25)', label: 'I16' },
  HUGEINT:  { bg: 'oklch(0.700 0.150 195 / 0.25)', label: 'HUGE' },
};

function getTypeBadge(type: string): { bg: string; label: string } {
  const base = type.replace(/\(.+\)/, '').trim().toUpperCase();
  return TYPE_BADGES[base] ?? { bg: 'oklch(0.500 0.060 250 / 0.25)', label: type.slice(0, 4).toUpperCase() };
}

// ── Sort chevron ─────────────────────────────────────────

function SortChevron({ direction }: { direction: 'asc' | 'desc' | null }) {
  return (
    <svg
      width="8"
      height="5"
      viewBox="0 0 8 5"
      fill="currentColor"
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

// ── Range slider (clean dual-handle) ─────────────────────

function RangeSlider({
  min, max, low, high, onRangeChange, path, colType,
}: {
  min: number;
  max: number;
  low: number;
  high: number;
  onRangeChange: (path: string, low: number, high: number) => void;
  path: string;
  colType: string;
}) {
  const range = max - min || 1;
  const lowPct = ((low - min) / range) * 100;
  const highPct = ((high - min) / range) * 100;
  const isFullRange = low <= min && high >= max;

  return (
    <div className="flex flex-col gap-0" style={{ minWidth: 80 }}>
      <div className="relative" style={{ height: 22 }}>
        {/* Background track */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full w-full"
          style={{ height: 2, background: 'var(--color-line)' }}
        />
        {/* Active range fill */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${lowPct}%`,
            width: `${highPct - lowPct}%`,
            height: 2,
            background: 'var(--color-cyan)',
            opacity: isFullRange ? 0.3 : 1,
          }}
        />
        <input
          type="range"
          className="range-thumb range-low absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min}
          max={max}
          step={(max - min) / 200 || 1}
          value={low}
          onChange={e => {
            const v = Number(e.target.value);
            onRangeChange(path, Math.min(v, high), high);
          }}
          style={{ zIndex: 3 }}
        />
        <input
          type="range"
          className="range-thumb range-high absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min}
          max={max}
          step={(max - min) / 200 || 1}
          value={high}
          onChange={e => {
            const v = Number(e.target.value);
            onRangeChange(path, low, Math.max(v, low));
          }}
          style={{ zIndex: 4 }}
        />
      </div>
      {!isFullRange && (
        <div className="flex justify-between text-fg-2" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-mono)' }}>
          <span>{formatCompact(low, colType)}</span>
          <span>{formatCompact(high, colType)}</span>
        </div>
      )}
    </div>
  );
}

// ── Skeleton loading ─────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-md border border-line" style={{ background: 'var(--color-void)' }}>
      <table className="w-full border-collapse font-mono text-body">
        <thead>
          <tr>
            {Array.from({ length: 5 }, (_, i) => (
              <th key={i} className="tbl-cell text-left" style={{ background: 'var(--color-raised)' }}>
                <div className="skeleton h-3 rounded" style={{ width: `${50 + i * 10}%` }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, r) => (
            <tr key={r} className="stagger-item" style={{ '--i': Math.min(r, 15) } as React.CSSProperties}>
              {Array.from({ length: 5 }, (_, c) => (
                <td key={c} className="tbl-cell">
                  <div className="skeleton h-3 rounded" style={{ width: `${40 + ((r + c) % 4) * 15}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Column expansion (STRUCT → sub-fields) ───────────────

interface ExpandedColumn {
  path:  string;
  label: string;
  type:  string;
}

function expandColumns(columns: ColumnInfo[]): ExpandedColumn[] {
  const result: ExpandedColumn[] = [];
  for (const col of columns) {
    if (col.type.startsWith('STRUCT(')) {
      const inner = col.type.match(/^STRUCT\((.+)\)$/s)?.[1];
      if (!inner) { result.push({ path: col.name, label: col.name, type: col.type }); continue; }
      const parts: string[] = [];
      let depth = 0, start = 0;
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '(') depth++;
        else if (inner[i] === ')') depth--;
        else if (inner[i] === ',' && depth === 0) { parts.push(inner.slice(start, i).trim()); start = i + 1; }
      }
      parts.push(inner.slice(start).trim());
      for (const part of parts) {
        const m = part.match(/^"?(\w+)"?\s+(.+)$/);
        if (m) result.push({ path: `${col.name}.${m[1]}`, label: m[1], type: m[2] });
      }
    } else {
      result.push({ path: col.name, label: col.name, type: col.type });
    }
  }
  return result;
}

/** Smart default width based on column type */
function defaultWidth(type: string): number {
  if (type === 'BOOLEAN') return 60;
  if (isNumericType(type)) return 85;
  return 130;
}

/** Display label for cardinality values — makes empty/null visible */
function displayValue(v: string): string {
  return v === '' || v === 'null' || v === 'undefined' ? '(empty)' : v;
}

// ── Facet select (lightweight Radix popover) ─────────────

function FacetSelect({
  label, values, active, onSelect,
}: {
  label: string;
  values: string[];
  active: string;
  onSelect: (v: string) => void;
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
        <Popover.Content
          sideOffset={4}
          align="start"
          className="bg-base border border-line shadow-lg rounded-md overflow-auto z-popover animate-fade-in"
          style={{ maxHeight: 240 }}
        >
          {active && (
            <button
              className="block text-left px-2 py-1 text-fg-2 font-mono cursor-pointer bg-transparent border-none hover:bg-raised transition-colors whitespace-nowrap"
              style={{ fontSize: 'var(--font-size-xs)', borderBottom: '1px solid var(--color-line)' }}
              onClick={() => { onSelect(''); setOpen(false); }}
            >
              Clear
            </button>
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
            >
              {displayValue(v)}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Main component ───────────────────────────────────────

export default function DataTable({
  columns, columnStats, columnCardinality, rows, totalRows, filteredCount,
  isQuerying, error, filters, onFilterChange, sort, onSortChange,
}: DataTableProps) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [rangeState, setRangeState] = useState<Record<string, [number, number]>>({});
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const expanded = useMemo(() => expandColumns(columns), [columns]);

  // Split columns: facets (≤FACET_MAX distinct or boolean → pulled above table), table (the rest)
  const { facetColumns, tableColumns } = useMemo(() => {
    const facets: ExpandedColumn[] = [];
    const table: ExpandedColumn[] = [];
    for (const col of expanded) {
      const card = columnCardinality[col.path];
      if (isBooleanType(col.type)) {
        facets.push(col);
      } else if (card && card.distinct >= 1 && card.distinct <= FACET_MAX) {
        facets.push(col); // 1 = constant (static label), 2–FACET_MAX = popover select
      } else {
        table.push(col); // numeric, >FACET_MAX distinct, or >DROPDOWN_MAX
      }
    }
    return { facetColumns: facets, tableColumns: table };
  }, [expanded, columnCardinality]);

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

  // Sort click handler: null → asc → desc → null
  const handleSortClick = useCallback((colPath: string) => {
    if (!sort || sort.column !== colPath) {
      onSortChange({ column: colPath, direction: 'asc' });
    } else if (sort.direction === 'asc') {
      onSortChange({ column: colPath, direction: 'desc' });
    } else {
      onSortChange(null);
    }
  }, [sort, onSortChange]);

  // Range filter change
  const handleRangeChange = useCallback((path: string, low: number, high: number) => {
    const stats = columnStats[path] ?? columnStats[path.split('.').pop()!];
    setRangeState(prev => ({ ...prev, [path]: [low, high] }));
    if (!stats) return;
    if (low <= stats.min && high >= stats.max) {
      onFilterChange(path, '');
    } else {
      onFilterChange(path, `BETWEEN ${low} AND ${high}`);
    }
  }, [columnStats, onFilterChange]);

  // Initialize range state from column stats
  useEffect(() => {
    const initial: Record<string, [number, number]> = {};
    for (const col of expanded) {
      if (!isNumericType(col.type)) continue;
      const stats = columnStats[col.path] ?? columnStats[col.path.split('.').pop()!];
      if (stats && !rangeState[col.path]) {
        initial[col.path] = [stats.min, stats.max];
      }
    }
    if (Object.keys(initial).length > 0) {
      setRangeState(prev => ({ ...initial, ...prev }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, columnStats]);

  if (columns.length === 0) return <TableSkeleton />;

  const totalWidth = tableColumns.reduce((sum, col) => sum + (colWidths[col.path] ?? defaultWidth(col.type)), 0);

  // Extract active pill/dropdown value from "= 'value'" filter format
  const activeFilterValue = useCallback((path: string): string => {
    const raw = filters[path] ?? '';
    const m = raw.match(/^= '(.+)'$/);
    return m ? m[1] : '';
  }, [filters]);

  // Emit "= 'value'" or "" for pill/dropdown controls
  const handleSelectFilter = useCallback((path: string, value: string) => {
    onFilterChange(path, value ? `= '${value}'` : '');
  }, [onFilterChange]);

  // Emit "= true"/"= false" or "" for boolean pills
  const handleBoolFilter = useCallback((path: string, value: string) => {
    onFilterChange(path, value ? `= ${value}` : '');
  }, [onFilterChange]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* ── Facet bar (low-cardinality columns pulled out of table) ── */}
      {facetColumns.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {facetColumns.map(col => {
            const boolean = isBooleanType(col.type);
            const card = columnCardinality[col.path];
            const isConstant = !boolean && card?.distinct === 1;

            if (isConstant) {
              return (
                <span
                  key={col.path}
                  className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono"
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    background: 'oklch(0.700 0.150 195 / 0.15)',
                    border: '1px solid oklch(0.700 0.150 195 / 0.25)',
                  }}
                >
                  <span className="text-fg-2">{col.label}</span>
                  <span style={{ color: 'var(--color-cyan)', fontWeight: 600 }}>{displayValue(card!.values[0])}</span>
                </span>
              );
            }

            const values = boolean ? ['true', 'false'] : (card?.values ?? []);
            const active = boolean
              ? (() => { const f = (filters[col.path] ?? '').trim(); return f === '= true' ? 'true' : f === '= false' ? 'false' : ''; })()
              : activeFilterValue(col.path);

            return (
              <FacetSelect
                key={col.path}
                label={col.label}
                values={values}
                active={active}
                onSelect={v => boolean ? handleBoolFilter(col.path, v) : handleSelectFilter(col.path, v)}
              />
            );
          })}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────── */}
      <div
        className="relative overflow-auto rounded-md border border-line"
        style={{ background: 'var(--color-void)', maxHeight: 480 }}
      >
        {/* Progress stripe */}
        {isQuerying && (
          <div className="absolute top-0 left-0 right-0 h-0.5 z-sticky progress-stripe" style={{ background: 'var(--color-cyan)' }} />
        )}

        <table
          className="border-collapse font-mono text-xs"
          style={{ width: totalWidth }}
        >
          {/* ── Header row ────────────────────────────────── */}
          <thead className="sticky top-0" style={{ zIndex: 'var(--z-index-sticky)' }}>
            <tr>
              {tableColumns.map(col => {
                const w = colWidths[col.path] ?? defaultWidth(col.type);
                const isFiltered = !!(filters[col.path] && filters[col.path].trim());
                const sortDir = sort?.column === col.path ? sort.direction : null;
                const badge = getTypeBadge(col.type);

                return (
                  <th
                    key={col.path}
                    className="tbl-cell text-left font-semibold text-fg-2 select-none relative group"
                    style={{
                      width: w,
                      minWidth: 60,
                      background: 'var(--color-raised)',
                      borderBottom: isFiltered ? '2px solid var(--color-cyan)' : '1px solid var(--color-line)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => handleSortClick(col.path)}
                  >
                    <div className="flex flex-col gap-0">
                      <div className="flex items-center gap-1">
                        <span className="truncate" style={{ fontSize: 'var(--font-size-sm)' }}>{col.label}</span>
                        <SortChevron direction={sortDir} />
                      </div>
                      <span
                        className="rounded-sm px-0.5 font-mono self-start"
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          background: badge.bg,
                          color: 'var(--color-fg-2)',
                          lineHeight: '1.4',
                        }}
                      >
                        {badge.label}
                      </span>
                    </div>

                    {/* Resize handle */}
                    <div
                      className="absolute top-0 right-0 bottom-0 opacity-0 group-hover:opacity-100 hover:!opacity-100"
                      style={{
                        width: 3,
                        cursor: 'col-resize',
                        background: 'var(--color-line)',
                        transition: 'opacity var(--t-fast), background var(--t-fast)',
                      }}
                      onMouseDown={e => {
                        e.stopPropagation();
                        handleResizeStart(col.path, e.clientX, w);
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--color-cyan)';
                        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--glow-cyan-sm)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--color-line)';
                        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                      }}
                    />
                  </th>
                );
              })}
            </tr>

            {/* ── Filter row ────────────────────────────────── */}
            <tr>
              {tableColumns.map(col => {
                const numeric = isNumericType(col.type);
                const stats = columnStats[col.path] ?? columnStats[col.path.split('.').pop()!];
                const w = colWidths[col.path] ?? defaultWidth(col.type);
                const card = columnCardinality[col.path];

                return (
                  <th
                    key={`filter-${col.path}`}
                    className="text-left font-normal px-1 py-0.5"
                    style={{
                      width: w,
                      minWidth: 60,
                      background: 'var(--color-base)',
                      borderBottom: '1px solid var(--color-line)',
                    }}
                  >
                    {numeric && stats ? (
                      <RangeSlider
                        min={stats.min}
                        max={stats.max}
                        low={rangeState[col.path]?.[0] ?? stats.min}
                        high={rangeState[col.path]?.[1] ?? stats.max}
                        onRangeChange={handleRangeChange}
                        path={col.path}
                        colType={col.type}
                      />
                    ) : card && card.distinct > FACET_MAX && card.distinct <= DROPDOWN_MAX ? (
                      /* FACET_MAX+1 – DROPDOWN_MAX distinct values → popover select */
                      <FacetSelect
                        label="All"
                        values={card.values}
                        active={activeFilterValue(col.path)}
                        onSelect={v => handleSelectFilter(col.path, v)}
                      />
                    ) : (
                      /* >50 distinct or unknown → text search */
                      <input
                        className="w-full bg-transparent border-none text-fg-2 font-mono placeholder:text-fg-3 focus:outline-none"
                        style={{ fontSize: 'var(--font-size-xs)' }}
                        placeholder="Search…"
                        value={filters[col.path] ?? ''}
                        onChange={e => onFilterChange(col.path, e.target.value)}
                        spellCheck={false}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* ── Data rows ───────────────────────────────────── */}
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className="stagger-item hover:brightness-110"
                style={{
                  '--i': Math.min(ri, 15),
                  background: ri % 2 === 1 ? 'oklch(0.120 0.020 250 / 0.3)' : undefined,
                } as React.CSSProperties}
              >
                {tableColumns.map(col => {
                  const val = getNestedValue(row, col.path);
                  const numeric = isNumericType(col.type);
                  const stats = numeric
                    ? (columnStats[col.path] ?? columnStats[col.path.split('.').pop()!])
                    : undefined;
                  const numVal = numeric ? Number(val) : NaN;

                  let cellStyle: React.CSSProperties = {
                    borderBottom: '1px solid var(--color-line)',
                  };
                  if (numeric && stats && !isNaN(numVal)) {
                    cellStyle = { ...cellStyle, ...heatmapStyle(numVal, stats.min, stats.max) };
                  }

                  return (
                    <td
                      key={col.path}
                      className="tbl-cell dt-heat"
                      style={{
                        ...cellStyle,
                        textAlign: numeric ? 'right' : 'left',
                        fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                      }}
                    >
                      {renderCell(val, col.type, numeric)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Empty state */}
        {rows.length === 0 && !isQuerying && (
          <div className="flex items-center justify-center py-6 text-fg-3 text-body">
            No rows match the current filters
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-2 py-1 text-sm font-mono" style={{ color: 'var(--color-red)' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Cell renderer ────────────────────────────────────────

function renderCell(value: unknown, colType: string, numeric: boolean): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-fg-3 italic">null</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span style={{ color: value ? 'var(--color-green)' : 'var(--color-fg-3)' }}>
        {String(value)}
      </span>
    );
  }

  if (numeric && typeof value === 'number') {
    return (
      <span title={value.toLocaleString()}>
        {formatCompact(value, colType)}
      </span>
    );
  }

  if (typeof value === 'number') {
    return <span title={value.toLocaleString()}>{formatCompact(value, colType)}</span>;
  }

  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    const display = json.length > 60 ? json.slice(0, 57) + '…' : json;
    return (
      <span className="text-fg-3" title={json} style={{ fontSize: 'var(--font-size-xs)' }}>
        {display}
      </span>
    );
  }

  const str = String(value);
  if (str.length > 60) {
    return <span title={str}>{str.slice(0, 57)}…</span>;
  }
  return <span>{str}</span>;
}

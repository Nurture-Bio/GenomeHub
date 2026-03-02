import { useRef, useState, useCallback, useEffect, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as Popover from '@radix-ui/react-popover';
import { Heading, Text, Badge } from '../ui';
import {
  useStrandFile,
  type RangePlan,
  type SecondaryFilters,
} from '../hooks/useStrandFile';

/**
 * Dev page: SBF binary file + HTTP Range requests + virtualizer-driven page fetching.
 *
 * Architecture:
 *   planRange(lo, hi)   — sync, binary-searches the sparse index → count for virtualizer
 *   fetchPage(...)      — async, fetches exactly PAGE_SIZE × 32B for the visible rows
 *
 * The virtualizer knows the total count without loading any records. As the user scrolls,
 * only the visible page (500 records × 32B = 16KB) is fetched. No row cap needed.
 *
 * Run the generator first:
 *   npx tsx packages/server/src/scripts/generateSbfFile.ts
 */

const SBF_URL    = '/crispr-1m.sbf';
const META_URL   = '/crispr-1m.sbf.json';
const PAGE_SIZE  = 500;   // records per page fetch  (500 × 32B = 16 KB)
const ROW_HEIGHT = 28;

// ── Table columns ────────────────────────────────────────

const COLUMNS: Array<{ name: string; type: string; width: number }> = [
  { name: 'chrom',        type: 'VARCHAR', width: 110 },
  { name: 'strand',       type: 'VARCHAR', width:  60 },
  { name: 'start',        type: 'INTEGER', width:  90 },
  { name: 'end',          type: 'INTEGER', width:  90 },
  { name: 'total_sites',  type: 'INTEGER', width:  90 },
  { name: 'off_targets',  type: 'INTEGER', width:  90 },
  { name: 'score',        type: 'DOUBLE',  width:  80 },
  { name: 'relative_pos', type: 'DOUBLE',  width:  90 },
];
const TOTAL_WIDTH = COLUMNS.reduce((s, c) => s + c.width, 0);

// ── Formatting ───────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(1)} ms`;
}
function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
  if (n >= 1_024)     return `${(n / 1_024).toFixed(1)} KB`;
  return `${n} B`;
}
function formatCell(value: unknown, type: string): string {
  if (value === null || value === undefined) return '';
  if (type === 'DOUBLE'  && typeof value === 'number') return value.toFixed(3);
  if (type === 'INTEGER' && typeof value === 'number') return value.toLocaleString();
  return String(value);
}

// ── Range slider ─────────────────────────────────────────

function RangeSlider({
  min, max, low, high, onChange,
}: {
  min: number; max: number; low: number; high: number;
  onChange: (lo: number, hi: number) => void;
}) {
  const range   = max - min || 1;
  const lowPct  = ((low  - min) / range) * 100;
  const highPct = ((high - min) / range) * 100;
  const isFull  = low <= min && high >= max;
  const step    = Math.max(1, Math.round(range / 200));

  return (
    <div className="flex flex-col gap-0" style={{ minWidth: 220 }}>
      <div className="relative" style={{ height: 22 }}>
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full w-full"
          style={{ height: 2, background: 'var(--color-line)' }} />
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%`, height: 2,
            background: 'var(--color-cyan)', opacity: isFull ? 0.3 : 1 }} />
        <input type="range"
          className="range-thumb range-low absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min} max={max} step={step} value={low}
          onChange={e => onChange(Math.min(Number(e.target.value), high), high)}
          style={{ zIndex: 3 }} />
        <input type="range"
          className="range-thumb range-high absolute inset-0 w-full appearance-none bg-transparent cursor-pointer"
          min={min} max={max} step={step} value={high}
          onChange={e => onChange(low, Math.max(Number(e.target.value), low))}
          style={{ zIndex: 4 }} />
      </div>
      <div className="flex justify-between font-mono"
        style={{ fontSize: 'var(--font-size-xs)', color: isFull ? 'var(--color-fg-3)' : 'var(--color-fg-2)' }}>
        <span>{low.toLocaleString()}</span>
        <span>{high.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ── Facet select ─────────────────────────────────────────

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
        >
          <span className="text-fg-2">{label}</span>
          {active && <span className="font-semibold" style={{ color: 'var(--color-cyan)' }}>{active}</span>}
          <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0 opacity-50">
            <path d="M2 3l2 2 2-2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={4} align="start"
          className="bg-base border border-line shadow-lg rounded-md overflow-auto z-popover animate-fade-in"
          style={{ maxHeight: 240 }}>
          {active && (
            <button
              className="block text-left px-2 py-1 text-fg-2 font-mono cursor-pointer bg-transparent border-none hover:bg-raised transition-colors whitespace-nowrap w-full"
              style={{ fontSize: 'var(--font-size-xs)', borderBottom: '1px solid var(--color-line)' }}
              onClick={() => { onSelect(''); setOpen(false); }}
            >Clear</button>
          )}
          {values.map(v => (
            <button key={v}
              className="block text-left px-2 py-1 font-mono cursor-pointer bg-transparent border-none hover:bg-raised transition-colors whitespace-nowrap w-full"
              style={{ fontSize: 'var(--font-size-xs)',
                color: v === active ? 'var(--color-cyan)' : 'var(--color-fg)',
                fontWeight: v === active ? 600 : 400 }}
              onClick={() => { onSelect(v === active ? '' : v); setOpen(false); }}
            >{v}</button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Virtual rows ─────────────────────────────────────────

/**
 * cacheVersion is passed as a prop so that memo busts when new pages load.
 * getRow(i) returns:
 *   undefined → page not yet fetched (shows "…" placeholder)
 *   null      → page loaded but record filtered by secondary filter (shows dim "—")
 *   object    → renderable row
 */
const VirtualRows = memo(function VirtualRows({
  scrollRef,
  count,
  getRow,
  cacheVersion: _cv,
}: {
  scrollRef:    React.RefObject<HTMLDivElement | null>;
  count:        number;
  getRow:       (index: number) => Record<string, unknown> | null | undefined;
  cacheVersion: number;
}) {
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize:     () => ROW_HEIGHT,
    overscan:         10,
  });

  return (
    <>
      {/* Spacer for total scroll height */}
      <table className="border-collapse" style={{ width: TOTAL_WIDTH }}>
        <tbody>
          <tr style={{ height: virtualizer.getTotalSize() }}>
            <td style={{ padding: 0, border: 'none' }} />
          </tr>
        </tbody>
      </table>

      {/* Absolutely positioned virtual rows */}
      <div style={{ position: 'relative', width: TOTAL_WIDTH, marginTop: -virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(vRow => {
          const row = getRow(vRow.index);
          return (
            <div
              key={vRow.key}
              className="flex"
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_HEIGHT,
                transform: `translateY(${vRow.start}px)`,
                background: vRow.index % 2 === 1 ? 'var(--color-row-stripe)' : undefined,
              }}
            >
              {row === undefined ? (
                // Loading placeholder
                <div className="font-mono" style={{
                  width: TOTAL_WIDTH, lineHeight: `${ROW_HEIGHT}px`,
                  fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)',
                  padding: '0 6px', borderBottom: '1px solid var(--color-line)',
                }}>…</div>
              ) : row === null ? (
                // Secondary-filter mismatch — dim placeholder preserving row position
                <div style={{
                  width: TOTAL_WIDTH, height: ROW_HEIGHT,
                  borderBottom: '1px solid var(--color-line)',
                  opacity: 0.15,
                }} />
              ) : (
                // Actual row
                COLUMNS.map(col => (
                  <div key={col.name} className="font-mono" style={{
                    width: col.width, flexShrink: 0,
                    padding: '0 6px', lineHeight: `${ROW_HEIGHT}px`,
                    fontSize: 'var(--font-size-xs)',
                    textAlign: col.type !== 'VARCHAR' ? 'right' : 'left',
                    fontVariantNumeric: col.type !== 'VARCHAR' ? 'tabular-nums' : undefined,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    borderBottom: '1px solid var(--color-line)',
                  }}>
                    {formatCell(row[col.name], col.type)}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </>
  );
});

// ── Page ─────────────────────────────────────────────────

export default function DevRangePage() {
  const { meta, isLoading, error, planRange, fetchPage } = useStrandFile(SBF_URL, META_URL);

  const [rangeLo,      setRangeLo]      = useState(0);
  const [rangeHi,      setRangeHi]      = useState(0);
  const [chromFilter,  setChromFilter]  = useState('');
  const [strandFilter, setStrandFilter] = useState('');
  const [rangePlan,    setRangePlan]    = useState<RangePlan | null>(null);

  // Cache version — incremented when a page loads to bust VirtualRows memo
  const [cacheVersion, setCacheVersion] = useState(0);

  // Perf stats for the most recently completed page fetch
  const [lastPageMs,   setLastPageMs]   = useState<number | null>(null);
  const [totalBytes,   setTotalBytes]   = useState(0);
  const [pagesLoaded,  setPagesLoaded]  = useState(0);

  // Page cache: cacheKey → sparse row array (null = filtered out)
  const pageCacheRef  = useRef<Map<string, (Record<string, unknown> | null)[]>>(new Map());
  const pendingRef    = useRef<Set<string>>(new Set());

  // Stable refs for filters (read inside fetchPage closures without re-creating getRow)
  const chromRef      = useRef(chromFilter);
  const strandRef     = useRef(strandFilter);
  chromRef.current    = chromFilter;
  strandRef.current   = strandFilter;

  const scrollRef     = useRef<HTMLDivElement>(null);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Range application ──────────────────────────────────
  const applyRange = useCallback((lo: number, hi: number) => {
    const plan = planRange(lo, hi);
    setRangePlan(plan);
    pageCacheRef.current.clear();
    pendingRef.current.clear();
    setTotalBytes(0);
    setPagesLoaded(0);
    setCacheVersion(0);
  }, [planRange]);

  // Init from meta: default to first 5% of the range
  useEffect(() => {
    if (!meta) return;
    const stats = meta.columnStats['start'];
    if (!stats) return;
    const span = Math.round((stats.max - stats.min) * 0.05);
    const lo   = stats.min;
    const hi   = lo + span;
    setRangeLo(lo);
    setRangeHi(hi);
    applyRange(lo, hi);
  }, [meta, applyRange]);

  const handleRangeChange = useCallback((lo: number, hi: number) => {
    setRangeLo(lo);
    setRangeHi(hi);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applyRange(lo, hi), 120);
  }, [applyRange]);

  // Re-apply plan when secondary filters change (invalidates page cache)
  const handleChromChange = useCallback((v: string) => {
    setChromFilter(v);
    pageCacheRef.current.clear();
    pendingRef.current.clear();
    setTotalBytes(0);
    setPagesLoaded(0);
    setCacheVersion(v2 => v2 + 1);
  }, []);

  const handleStrandChange = useCallback((v: string) => {
    setStrandFilter(v);
    pageCacheRef.current.clear();
    pendingRef.current.clear();
    setTotalBytes(0);
    setPagesLoaded(0);
    setCacheVersion(v2 => v2 + 1);
  }, []);

  // ── getRow — called by virtualizer for every visible index ──
  const getRow = useCallback((index: number): Record<string, unknown> | null | undefined => {
    if (!rangePlan) return undefined;

    const pageNum  = Math.floor(index / PAGE_SIZE);
    const cacheKey = `${rangePlan.byteStart}:${pageNum}`;

    // Cache hit
    const cached = pageCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      return (cached[index % PAGE_SIZE] ?? null) as Record<string, unknown> | null;
    }

    // Trigger async page fetch (once per page)
    if (!pendingRef.current.has(cacheKey)) {
      pendingRef.current.add(cacheKey);
      const firstIdx = pageNum * PAGE_SIZE;
      const filters: SecondaryFilters = {};
      if (chromRef.current)  filters.chrom  = chromRef.current;
      if (strandRef.current) filters.strand = strandRef.current;

      fetchPage(rangePlan.byteStart, firstIdx, PAGE_SIZE, filters)
        .then(result => {
          pageCacheRef.current.set(cacheKey, result.rows);
          pendingRef.current.delete(cacheKey);
          setLastPageMs(result.fetchMs);
          setTotalBytes(b => b + result.bytesRead);
          setPagesLoaded(p => p + 1);
          setCacheVersion(v => v + 1);
        })
        .catch(console.error);
    }

    return undefined; // loading
  }, [rangePlan, fetchPage]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ── Derived ───────────────────────────────────────────
  const startStats   = meta?.columnStats['start'];
  const chromValues  = meta?.columnCardinality['chrom']?.values  ?? [];
  const strandValues = meta?.columnCardinality['strand']?.values ?? [];

  // ── Error state ───────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3"
        style={{ background: 'var(--color-void)', height: 'calc(100dvh - 2.5rem)' }}>
        <Text variant="dim">Failed to load SBF file</Text>
        <Text variant="caption" as="p" style={{ fontFamily: 'var(--font-mono)' }}>{error}</Text>
        <Text variant="dim" as="p" style={{ maxWidth: 480, textAlign: 'center', marginTop: '0.5rem' }}>
          Run the generator first:
        </Text>
        <code style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)',
          background: 'var(--color-raised)', borderRadius: 4, padding: '6px 10px',
        }}>
          npx tsx packages/server/src/scripts/generateSbfFile.ts
        </code>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ background: 'var(--color-void)', height: 'calc(100dvh - 2.5rem)' }}>

      {/* Header */}
      <div className="px-4 py-3 border-b border-line flex items-center gap-3 flex-wrap"
        style={{ background: 'var(--color-base)' }}>
        <Heading as="span" level="subheading">Range Request Demo</Heading>
        {isLoading ? (
          <Text variant="dim">Loading index…</Text>
        ) : meta ? (
          <Text variant="dim">{meta.recordCount.toLocaleString()} records · 30.5 MB binary file</Text>
        ) : null}
        <Badge variant="count" color="dim">.sbf</Badge>
        <Badge variant="count" color="dim">virtual scroll</Badge>
      </div>

      <div className="flex-1 overflow-hidden p-4 flex flex-col gap-3">

        {/* Controls */}
        {meta && startStats && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-mono text-fg-2" style={{ fontSize: 'var(--font-size-xs)' }}>start</span>
              <RangeSlider
                min={startStats.min} max={startStats.max}
                low={rangeLo} high={rangeHi}
                onChange={handleRangeChange}
              />
            </div>
            <FacetSelect label="chrom"  values={chromValues}  active={chromFilter}  onSelect={handleChromChange}  />
            <FacetSelect label="strand" values={strandValues} active={strandFilter} onSelect={handleStrandChange} />
          </div>
        )}

        {/* Metrics */}
        {rangePlan && (
          <div className="flex items-center gap-3 flex-wrap font-mono"
            style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-2)' }}>
            <span>
              Records in range:{' '}
              <span style={{ color: 'var(--color-fg)' }}>{rangePlan.count.toLocaleString()}</span>
            </span>
            <span style={{ color: 'var(--color-line)' }}>|</span>
            <span>
              Pages loaded:{' '}
              <span style={{ color: 'var(--color-fg)' }}>{pagesLoaded}</span>
              <span style={{ color: 'var(--color-fg-3)' }}>
                {' '}× {fmtBytes(PAGE_SIZE * (meta?.stride ?? 32))} = {fmtBytes(totalBytes)} fetched
              </span>
            </span>
            {lastPageMs !== null && (
              <>
                <span style={{ color: 'var(--color-line)' }}>|</span>
                <span>
                  Last page:{' '}
                  <span style={{ color: lastPageMs < 20 ? 'var(--color-cyan)' : 'var(--color-fg)' }}>
                    {fmtMs(lastPageMs)}
                  </span>
                </span>
              </>
            )}
            {(chromFilter || strandFilter) && (
              <>
                <span style={{ color: 'var(--color-line)' }}>|</span>
                <span style={{ color: 'oklch(0.750 0.150 60)' }}>
                  dim rows filtered by secondary filter
                </span>
              </>
            )}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 flex flex-col overflow-hidden rounded-md border border-line"
          style={{ background: 'var(--color-void)' }}>

          {/* Pinned header */}
          <div className="shrink-0 flex font-mono text-xs"
            style={{ background: 'var(--color-raised)', borderBottom: '2px solid var(--color-line)' }}>
            {COLUMNS.map(col => (
              <div key={col.name} style={{
                width: col.width, flexShrink: 0, padding: '3px 6px',
                textAlign: col.type !== 'VARCHAR' ? 'right' : 'left',
                fontWeight: 600, color: 'var(--color-fg-2)',
                whiteSpace: 'nowrap', overflow: 'hidden',
              }}>
                {col.name}
              </div>
            ))}
          </div>

          {/* Scrollable body */}
          <div ref={scrollRef} className="flex-1 overflow-auto">
            {rangePlan ? (
              <VirtualRows
                scrollRef={scrollRef}
                count={rangePlan.count}
                getRow={getRow}
                cacheVersion={cacheVersion}
              />
            ) : isLoading ? (
              <div className="flex items-center justify-center py-6 font-mono text-xs text-fg-3">
                Loading file index…
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        {meta && (
          <div className="flex gap-4 flex-wrap font-mono"
            style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-fg-3)' }}>
            <span>page size: {PAGE_SIZE} rows · {fmtBytes(PAGE_SIZE * meta.stride)}</span>
            <span>index: {fmtBytes(meta.dataByteOffset)} loaded on mount</span>
            <span>blocks: {Math.ceil(meta.recordCount / meta.indexBlockSize)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

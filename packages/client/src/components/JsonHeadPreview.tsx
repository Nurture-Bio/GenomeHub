/**
 * JsonHeadPreview — lightweight JSON array preview.
 *
 * Reads the first 1,000 records from a JSON array via ReadableStream,
 * aborts the connection, and displays the rows in a virtualised table.
 *
 * No SharedArrayBuffer. No Web Worker. No global stats computation.
 * Memory: O(limit) — only the parsed head rows are held.
 */

import { useRef, useMemo, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Text, Badge } from '../ui';
import { JsonHeadScanner } from '../lib/scanners';
import { useDatasetHead } from '../hooks/useDatasetHead';

// ── Constants ────────────────────────────────────────────────────────────────

const ROW_H       = 28;
const PANEL_H     = 560;
const PX_PER_CHAR = 7.5;
const MIN_COL_W   = 50;
const MAX_COL_W   = 300;
const COL_PADDING = 20;
const HEAD_LIMIT  = 1_000;

const scanner = new JsonHeadScanner();

// ── Formatting ───────────────────────────────────────────────────────────────

function fmt(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    if (!Number.isInteger(value)) return value.toFixed(2);
    const a = Math.abs(value);
    if (a >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
    if (a >= 10_000)    return (value / 1_000).toFixed(1) + 'K';
    return value.toLocaleString();
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const s = JSON.stringify(value);
    return s.length > 32 ? s.slice(0, 30) + '\u2026' : s;
  }
  const s = String(value);
  return s.length > 32 ? s.slice(0, 30) + '\u2026' : s;
}

function isNumeric(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function colWFromName(name: string): number {
  const chars = Math.max(8, name.length);
  const px    = Math.round(chars * PX_PER_CHAR) + COL_PADDING;
  return Math.min(MAX_COL_W, Math.max(MIN_COL_W, px));
}

// ── Component ────────────────────────────────────────────────────────────────

export default function JsonHeadPreview({ url }: { url: string }) {
  const { status, rows, truncated, error } = useDatasetHead(url, scanner, HEAD_LIMIT);

  const scrollRef  = useRef<HTMLDivElement>(null);
  const headerRef  = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<{ name: string; startX: number; startW: number } | null>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [sort, setSort] = useState<{ name: string; dir: 'asc' | 'desc' } | null>(null);

  // ── Derive columns from first row ────────────────────────────────────────

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    const keys = new Set<string>();
    // Sample first 50 rows for key discovery (handles sparse objects).
    const sample = Math.min(rows.length, 50);
    for (let i = 0; i < sample; i++) {
      for (const key of Object.keys(rows[i] as Record<string, unknown>)) {
        keys.add(key);
      }
    }
    return [...keys];
  }, [rows]);

  // ── Sort ─────────────────────────────────────────────────────────────────

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = sort.name;
    return [...rows].sort((a, b) => {
      const ra = a as Record<string, unknown>;
      const rb = b as Record<string, unknown>;
      const av = ra[key];
      const bv = rb[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    });
  }, [rows, sort]);

  // ── Sort click ───────────────────────────────────────────────────────────

  const handleSortClick = useCallback((name: string) => {
    setSort(prev => {
      if (!prev || prev.name !== name) return { name, dir: 'asc' };
      if (prev.dir === 'asc') return { name, dir: 'desc' };
      return null;
    });
  }, []);

  // ── Column resize ────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((name: string, startX: number, startW: number) => {
    resizingRef.current = { name, startX, startW };
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      setColWidths(prev => ({
        ...prev,
        [resizingRef.current!.name]: Math.max(50, resizingRef.current!.startW + e.clientX - resizingRef.current!.startX),
      }));
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

  // ── Virtualizer ──────────────────────────────────────────────────────────

  const virtualizer = useVirtualizer({
    count:            sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize:     () => ROW_H,
    overscan:         40,
  });

  // ── Derived ──────────────────────────────────────────────────────────────

  const totalWidth = columns.reduce((s, c) => s + (colWidths[c] ?? colWFromName(c)), 0);

  // ── Loading / error states ───────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center py-8">
        <Text variant="dim" style={{ color: 'var(--color-red)' }}>{error}</Text>
      </div>
    );
  }

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex items-center justify-center" style={{ height: PANEL_H, background: 'var(--color-void)' }}>
        <Text variant="dim">Loading preview…</Text>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height: PANEL_H, background: 'var(--color-void)' }}>
        <Text variant="dim">No records found</Text>
      </div>
    );
  }

  // ── Main layout ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ background: 'var(--color-void)', height: PANEL_H }}>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-b border-line flex items-center gap-2 shrink-0"
        style={{ background: 'var(--color-base)' }}>
        <Text variant="dim">
          {rows.length.toLocaleString()} record{rows.length !== 1 ? 's' : ''}
        </Text>
        {truncated && (
          <Badge variant="count" color="dim">
            showing first {HEAD_LIMIT.toLocaleString()}
          </Badge>
        )}
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Pinned column header */}
        <div ref={headerRef} className="shrink-0 overflow-hidden font-mono">
          <div className="flex" style={{ width: totalWidth }}>
            {columns.map(name => {
              const w       = colWidths[name] ?? colWFromName(name);
              const sortDir = sort && sort.name === name ? sort.dir : null;
              return (
                <div key={name}
                  className="text-left font-semibold text-fg-2 select-none relative group cursor-pointer"
                  style={{
                    width: w, minWidth: 50, flexShrink: 0, padding: '3px 6px',
                    background: 'var(--color-raised)',
                    borderBottom: `2px solid ${sortDir ? 'var(--color-cyan)' : 'var(--color-line)'}`,
                    whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)',
                  }}
                  onClick={() => handleSortClick(name)}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{name}</span>
                    <SortChevron dir={sortDir} />
                  </div>
                  {/* Resize handle */}
                  <div
                    className="absolute top-0 right-0 bottom-0 opacity-0 group-hover:opacity-100"
                    style={{ width: 3, cursor: 'col-resize', background: 'var(--color-line)', transition: 'opacity var(--t-fast)' }}
                    onMouseDown={e => { e.stopPropagation(); handleResizeStart(name, e.clientX, w); }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-cyan)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-line)'; }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable body */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto"
          onScroll={() => {
            if (headerRef.current && scrollRef.current)
              headerRef.current.scrollLeft = scrollRef.current.scrollLeft;
          }}
        >
          <div style={{ height: virtualizer.getTotalSize(), width: totalWidth }} />
          <div style={{ position: 'relative', width: totalWidth, marginTop: -virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map(vRow => {
              const row = sortedRows[vRow.index] as Record<string, unknown>;
              return (
                <div key={vRow.key} className="flex"
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H,
                    transform: `translateY(${vRow.start}px)`,
                    background: vRow.index % 2 === 1 ? 'var(--color-row-stripe)' : undefined,
                  }}
                >
                  {columns.map(name => {
                    const w     = colWidths[name] ?? colWFromName(name);
                    const value = row[name];
                    const num   = isNumeric(value);

                    return (
                      <div key={name} style={{
                        width: w, minWidth: 50, flexShrink: 0,
                        padding: '0 6px',
                        borderBottom: '1px solid var(--color-line)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        textAlign: num ? 'right' : 'left',
                        fontVariantNumeric: num ? 'tabular-nums' : undefined,
                        lineHeight: `${ROW_H}px`,
                        fontSize: 'var(--font-size-xs)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {value === null || value === undefined
                          ? <span style={{ color: 'var(--color-fg-3)', fontStyle: 'italic' }}>{'\u2014'}</span>
                          : fmt(value)
                        }
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SortChevron ──────────────────────────────────────────────────────────────

function SortChevron({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{
      flexShrink: 0, transition: 'transform var(--t-fast) var(--ease-move)',
      transform: dir === 'desc' ? 'rotate(180deg)' : 'none',
      opacity: dir ? 1 : 0.3, color: dir ? 'var(--color-cyan)' : 'inherit',
    }}>
      <path d="M4 0L7.5 4.5H0.5L4 0Z" />
    </svg>
  );
}

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { isNumericType, DROPDOWN_MAX } from '../hooks/useJsonDuckDb';
import type { ColumnInfo, SortSpec, ColumnStats, ColumnCardinality } from '../hooks/useJsonDuckDb';
import DataTable from '../components/DataTable';
import { Heading, Text, Badge } from '../ui';

/**
 * Dev-only page: renders DataTable with mock CRISPR guide data.
 * No server, no DuckDB, no auth. Just `npm run dev` and open /dev/table.
 */

// ── Mock data generator ──────────────────────────────────

const CHROMS = Array.from({ length: 34 }, (_, i) => `contig_${i < 12 ? i + 22 : i + 90}`);
const STRANDS = ['+', '-'] as const;
const MATCHED_PAMS = ['AGG', 'TGG', 'CGG', 'GGG'];
const BASES = 'ACGT';

function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min: number, max: number) { return Math.random() * (max - min) + min; }
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randSeq(len: number) { return Array.from({ length: len }, () => BASES[randInt(0, 3)]).join(''); }
function hexId() { return Math.random().toString(16).slice(2, 10); }

function generateRow(): Record<string, unknown> {
  const chrom = pick(CHROMS);
  const start = randInt(1000, 200000);
  const end = start + 23;
  const strand = pick(STRANDS);
  const offTargets = randInt(0, 88);
  const totalSites = offTargets + 1;
  const score = offTargets;
  const spacer = randSeq(20);
  const matched = pick(MATCHED_PAMS);
  const featureStart = start + randInt(-500, 0);
  const featureEnd = featureStart + 500;
  const overlap = randInt(1, 23);
  const offset = randInt(-22, 499);
  const relativePos = randFloat(-10.5, 1.0);
  const signedDistance = randInt(-522, 21);

  return {
    chrom, start, end, strand, score: score * 1.0, name: hexId(),
    tags: {
      pattern: 'NGG', matched, guide_id: hexId(),
      pam_start: end - 3, pam_end: end,
      spacer, guide_seq: spacer + matched,
      total_sites: totalSites, off_targets: offTargets,
      feature_name: '', feature_type: 'promoter',
      feature_start: featureStart, feature_end: featureEnd,
      feature_strand: pick(STRANDS),
      overlap, offset, relative_pos: Math.round(relativePos * 1000) / 1000,
      signed_distance: signedDistance,
    },
  };
}

// ── Flatten struct into expanded columns (mirrors DuckDB DESCRIBE) ──

const COLUMNS: ColumnInfo[] = [
  { name: 'chrom', type: 'VARCHAR' },
  { name: 'start', type: 'INTEGER' },
  { name: 'end', type: 'INTEGER' },
  { name: 'strand', type: 'VARCHAR' },
  { name: 'score', type: 'DOUBLE' },
  { name: 'name', type: 'VARCHAR' },
  { name: 'tags', type: 'STRUCT(pattern VARCHAR, matched VARCHAR, guide_id VARCHAR, pam_start INTEGER, pam_end INTEGER, spacer VARCHAR, guide_seq VARCHAR, total_sites INTEGER, off_targets INTEGER, feature_name VARCHAR, feature_type VARCHAR, feature_start INTEGER, feature_end INTEGER, feature_strand VARCHAR, overlap INTEGER, offset INTEGER, relative_pos DOUBLE, signed_distance INTEGER)' },
];

// After struct expansion the paths are: chrom, start, end, strand, score, name,
// tags.pattern, tags.matched, ... etc.

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

interface ExpandedCol { path: string; type: string; }

function getExpandedCols(): ExpandedCol[] {
  const out: ExpandedCol[] = [];
  for (const col of COLUMNS) {
    if (col.type.startsWith('STRUCT(')) {
      // Parse sub-fields
      const inner = col.type.match(/^STRUCT\((.+)\)$/s)?.[1] ?? '';
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
        if (m) out.push({ path: `${col.name}.${m[1]}`, type: m[2] });
      }
    } else {
      out.push({ path: col.name, type: col.type });
    }
  }
  return out;
}

// ── Client-side filter + sort ────────────────────────────

function matchesFilter(row: Record<string, unknown>, path: string, filterVal: string, colType: string): boolean {
  const val = getNestedValue(row, path);
  const trimmed = filterVal.trim();
  if (!trimmed) return true;

  // BETWEEN x AND y
  const betweenMatch = trimmed.match(/^BETWEEN\s+([\d.e+-]+)\s+AND\s+([\d.e+-]+)$/i);
  if (betweenMatch) {
    const num = Number(val);
    return num >= Number(betweenMatch[1]) && num <= Number(betweenMatch[2]);
  }

  // Boolean
  if (colType === 'BOOLEAN') {
    if (trimmed === '= true') return val === true;
    if (trimmed === '= false') return val === false;
    return true;
  }

  // Exact match from pill toggle / dropdown: = 'value'
  const exactMatch = trimmed.match(/^= '(.+)'$/);
  if (exactMatch) {
    return String(val ?? '') === exactMatch[1];
  }

  // String search (case-insensitive contains)
  if (!isNumericType(colType)) {
    return String(val ?? '').toLowerCase().includes(trimmed.toLowerCase());
  }

  return true;
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

// ── Component ────────────────────────────────────────────

const TOTAL_MOCK_ROWS = 2000;

export default function DevTablePage() {
  // Generate mock data once
  const allRows = useMemo(() => Array.from({ length: TOTAL_MOCK_ROWS }, generateRow), []);
  const expandedCols = useMemo(getExpandedCols, []);

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [debouncedFilters, setDebouncedFilters] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sort, setSort] = useState<SortSpec | null>(null);

  // Compute column stats from all rows
  const columnStats = useMemo(() => {
    const stats: Record<string, ColumnStats> = {};
    for (const col of expandedCols) {
      if (!isNumericType(col.type)) continue;
      let min = Infinity, max = -Infinity;
      for (const row of allRows) {
        const v = Number(getNestedValue(row, col.path));
        if (isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min !== Infinity) stats[col.path] = { min, max };
    }
    return stats;
  }, [allRows, expandedCols]);

  // Compute cardinality from all rows (once, against full dataset)
  const columnCardinality = useMemo(() => {
    const result: Record<string, ColumnCardinality> = {};
    for (const col of expandedCols) {
      if (isNumericType(col.type)) continue;
      const set = new Set<string>();
      let overflow = false;
      for (const row of allRows) {
        const v = String(getNestedValue(row, col.path) ?? '');
        set.add(v);
        if (set.size > DROPDOWN_MAX) { overflow = true; break; }
      }
      result[col.path] = {
        distinct: overflow ? DROPDOWN_MAX + 1 : set.size,
        values: overflow ? [] : [...set].sort(),
      };
    }
    return result;
  }, [allRows, expandedCols]);

  // Filter + sort (uses debounced filters so sliders stay responsive)
  const visibleRows = useMemo(() => {
    let rows = allRows;

    const activeFilters = Object.entries(debouncedFilters).filter(([, v]) => v.trim());
    if (activeFilters.length) {
      rows = rows.filter(row =>
        activeFilters.every(([path, val]) => {
          const col = expandedCols.find(c => c.path === path);
          return matchesFilter(row, path, val, col?.type ?? 'VARCHAR');
        })
      );
    }

    if (sort) {
      const dir = sort.direction === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) =>
        dir * compareValues(getNestedValue(a, sort.column), getNestedValue(b, sort.column))
      );
    }

    return rows.slice(0, 1000);
  }, [allRows, debouncedFilters, sort, expandedCols]);

  const filteredCount = useMemo(() => {
    const activeFilters = Object.entries(debouncedFilters).filter(([, v]) => v.trim());
    if (!activeFilters.length) return allRows.length;
    return allRows.filter(row =>
      activeFilters.every(([path, val]) => {
        const col = expandedCols.find(c => c.path === path);
        return matchesFilter(row, path, val, col?.type ?? 'VARCHAR');
      })
    ).length;
  }, [allRows, debouncedFilters, expandedCols]);

  const handleFilterChange = useCallback((path: string, val: string) => {
    // Update display state immediately (slider position)
    setFilters(prev => ({ ...prev, [path]: val }));
    // Debounce the expensive filtering
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedFilters(prev => ({ ...prev, [path]: val }));
    }, 150);
  }, []);

  const handleSortChange = useCallback((s: SortSpec | null) => {
    setSort(s);
  }, []);

  const isFiltered = Object.values(filters).some(v => v.trim());

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-void)' }}>
      <div className="px-4 py-3 border-b border-line flex items-center gap-3" style={{ background: 'var(--color-base)' }}>
        <Heading as="span" level="subheading">DataTable Dev</Heading>
        <Text variant="dim">{TOTAL_MOCK_ROWS.toLocaleString()} mock CRISPR guides</Text>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Text variant="muted">Preview</Text>
          <Badge variant="count" color="dim">
            {isFiltered
              ? `${filteredCount.toLocaleString()} / ${allRows.length.toLocaleString()}`
              : allRows.length.toLocaleString()
            } rows
          </Badge>
          {filteredCount > 1000 && (
            <Badge variant="count" color="dim">first 1 000</Badge>
          )}
        </div>

        <DataTable
          columns={COLUMNS}
          columnStats={columnStats}
          columnCardinality={columnCardinality}
          rows={visibleRows}
          totalRows={allRows.length}
          filteredCount={filteredCount}
          isQuerying={false}
          filters={filters}
          onFilterChange={handleFilterChange}
          sort={sort}
          onSortChange={handleSortChange}
        />
      </div>
    </div>
  );
}

/**
 * useStrandFile — HTTP Range request reader for .sbf (Sorted Binary File).
 *
 * Two-phase API:
 *   planRange(lo, hi)          Synchronous. Binary-searches the cached sparse index
 *                               to find the exact byte window and record count for a
 *                               start-range filter. No network call.
 *
 *   fetchPage(byteStart,       Async. Fetches exactly `pageSize` records starting at
 *             firstIdx,         `byteStart + firstIdx * stride`. Issues one Range
 *             pageSize,         request of `pageSize * stride` bytes. Secondary
 *             filters?)         filters (chrom, strand) are applied in-buffer; filtered
 *                               slots come back as `null` so the caller's virtual index
 *                               mapping stays exact.
 *
 * The virtualizer drives data fetching: planRange gives the total row count for scroll
 * height, and fetchPage is called lazily for each visible page.
 *
 * File format expected (32 bytes/record, sorted by `start` ascending):
 *   Header  32 bytes
 *   Index   ceil(N/BLOCK_SIZE) × 8 bytes  [start_value: i32][record_seq: u32]
 *   Records N × STRIDE bytes
 *
 * Record layout:
 *   [0]   chrom:        u8   index into SbfMeta.columnCardinality.chrom.values
 *   [1]   strand:       u8   (0 = '+', 1 = '-')
 *   [2-3] pad
 *   [4]   start:        i32
 *   [8]   end:          i32
 *   [12]  total_sites:  i32
 *   [16]  off_targets:  i32
 *   [20]  score:        f32
 *   [24]  relative_pos: f32
 *   [28-31] pad
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Public types ─────────────────────────────────────────

export interface SbfColumnDef {
  name: string;
  type: 'VARCHAR' | 'INTEGER' | 'DOUBLE';
}

export interface SbfColumnStats {
  min: number;
  max: number;
}

export interface SbfCardinality {
  distinct: number;
  values: string[];
}

export interface SbfMeta {
  recordCount:       number;
  stride:            number;
  indexBlockSize:    number;
  indexByteOffset:   number;
  dataByteOffset:    number;
  columns:           SbfColumnDef[];
  columnStats:       Record<string, SbfColumnStats>;
  columnCardinality: Record<string, SbfCardinality>;
}

export interface SecondaryFilters {
  chrom?:  string; // '' = no filter
  strand?: string; // '' = no filter
}

/** Result of planRange — no network I/O. */
export interface RangePlan {
  byteStart: number;
  byteEnd:   number;
  count:     number; // exact records in this byte window (before secondary filters)
}

/** One page of fetched records. `rows[i]` is null when the record was filtered by secondary filters. */
export interface PageResult {
  /** Length exactly = min(pageSize, records remaining in file). */
  rows:      (Record<string, unknown> | null)[];
  fetchMs:   number;
  bytesRead: number;
}

export interface UseStrandFileReturn {
  meta:      SbfMeta | null;
  isLoading: boolean;
  error:     string | null;

  /**
   * Synchronously compute byte range + record count for a start filter [lo, hi].
   * Returns null if the index hasn't loaded yet.
   */
  planRange: (lo: number, hi: number) => RangePlan | null;

  /**
   * Fetch `pageSize` records at file position `byteStart + firstIdx * stride`.
   * Issues a single Range request of `pageSize * stride` bytes.
   * Secondary filters produce null slots; the array length = actual records in the fetch.
   */
  fetchPage: (
    byteStart: number,
    firstIdx:  number,
    pageSize:  number,
    filters?:  SecondaryFilters,
  ) => Promise<PageResult>;
}

// ── Constants ────────────────────────────────────────────

const MAGIC = 0x53424631; // 'SBF1'
const STRAND_CHARS = ['+', '-'];

// ── Binary search helpers ────────────────────────────────

/** Last block i where index[i].start_value <= target. Falls back to 0. */
function bisectRight(index: Int32Array, blockCount: number, target: number): number {
  let lo = 0;
  let hi = blockCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (index[mid * 2] <= target) lo = mid;
    else                          hi = mid - 1;
  }
  return lo;
}

/** First block i where index[i].start_value > target. Falls back to blockCount - 1. */
function bisectLeft(index: Int32Array, blockCount: number, target: number): number {
  let lo = 0;
  let hi = blockCount - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid * 2] <= target) lo = mid + 1;
    else                          hi = mid;
  }
  return lo;
}

// ── Hook ─────────────────────────────────────────────────

export function useStrandFile(sbfUrl: string, metaUrl: string): UseStrandFileReturn {
  const [meta, setMeta]         = useState<SbfMeta | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const indexRef = useRef<Int32Array | null>(null);
  const metaRef  = useRef<SbfMeta | null>(null);

  // ── Mount: fetch header+index + sidecar ──────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const sidecarRes = await fetch(metaUrl);
        if (!sidecarRes.ok) throw new Error(`Sidecar fetch failed: ${sidecarRes.status}`);
        const sbfMeta: SbfMeta = await sidecarRes.json() as SbfMeta;

        if (
          typeof sbfMeta.dataByteOffset !== 'number' ||
          typeof sbfMeta.indexByteOffset !== 'number' ||
          typeof sbfMeta.recordCount !== 'number'
        ) {
          throw new Error('Invalid sidecar JSON: missing required fields');
        }

        const headerRes = await fetch(sbfUrl, {
          headers: { Range: `bytes=0-${sbfMeta.dataByteOffset - 1}` },
        });
        if (!headerRes.ok && headerRes.status !== 206) {
          throw new Error(`Header fetch failed: ${headerRes.status}`);
        }

        const headerBuf = await headerRes.arrayBuffer();
        const headerDv  = new DataView(headerBuf);
        const magic     = headerDv.getUint32(0, true);
        if (magic !== MAGIC) {
          throw new Error(`Invalid magic: 0x${magic.toString(16)}`);
        }

        const indexBuf  = headerBuf.slice(sbfMeta.indexByteOffset, sbfMeta.dataByteOffset);
        const indexView = new Int32Array(indexBuf);

        if (cancelled) return;
        indexRef.current = indexView;
        metaRef.current  = sbfMeta;
        setMeta(sbfMeta);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [sbfUrl, metaUrl]);

  // ── planRange — synchronous ───────────────────────────
  const planRange = useCallback((lo: number, hi: number): RangePlan | null => {
    const m   = metaRef.current;
    const idx = indexRef.current;
    if (!m || !idx) return null;

    const blockCount = Math.ceil(m.recordCount / m.indexBlockSize);

    const iLo = Math.max(0,              bisectRight(idx, blockCount, lo) - 1);
    const iHi = Math.min(blockCount - 1, bisectLeft(idx, blockCount, hi)  + 1);

    const byteStart = m.dataByteOffset + iLo * m.indexBlockSize * m.stride;
    const byteEnd   = Math.min(
      m.dataByteOffset + (iHi + 1) * m.indexBlockSize * m.stride - 1,
      m.dataByteOffset + m.recordCount * m.stride - 1,
    );

    const count = Math.floor((byteEnd - byteStart + 1) / m.stride);
    return { byteStart, byteEnd, count };
  }, []); // refs are stable — no deps needed

  // ── fetchPage — async ─────────────────────────────────
  const fetchPage = useCallback(async (
    byteStart: number,
    firstIdx:  number,
    pageSize:  number,
    filters:   SecondaryFilters = {},
  ): Promise<PageResult> => {
    const m = metaRef.current;
    if (!m) return { rows: [], fetchMs: 0, bytesRead: 0 };

    const t0 = performance.now();

    const rangeStart = byteStart + firstIdx * m.stride;
    const rangeEnd   = rangeStart + pageSize * m.stride - 1;

    const res = await fetch(sbfUrl, {
      headers: { Range: `bytes=${rangeStart}-${rangeEnd}` },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`fetchPage failed: ${res.status}`);
    }

    const buf = await res.arrayBuffer();
    const dv  = new DataView(buf);

    const chromValues  = m.columnCardinality['chrom']?.values ?? [];
    const chromFilter  = filters.chrom  ?? '';
    const strandFilter = filters.strand ?? '';

    const recordsInBuf = Math.floor(buf.byteLength / m.stride);
    // Sparse array: length = pageSize, entries are null for out-of-range or filtered records
    const rows: (Record<string, unknown> | null)[] = new Array(pageSize).fill(null);

    for (let r = 0; r < recordsInBuf; r++) {
      const off       = r * m.stride;
      const chromIdx  = dv.getUint8(off);
      const strandIdx = dv.getUint8(off + 1);
      const chrom     = chromValues[chromIdx] ?? `idx_${chromIdx}`;
      const strand    = STRAND_CHARS[strandIdx] ?? '?';

      if (chromFilter  && chrom  !== chromFilter)  continue;
      if (strandFilter && strand !== strandFilter) continue;

      rows[r] = {
        chrom,
        strand,
        start:        dv.getInt32(  off + 4,  true),
        end:          dv.getInt32(  off + 8,  true),
        total_sites:  dv.getInt32(  off + 12, true),
        off_targets:  dv.getInt32(  off + 16, true),
        score:        dv.getFloat32(off + 20, true),
        relative_pos: dv.getFloat32(off + 24, true),
      };
    }

    return { rows, fetchMs: performance.now() - t0, bytesRead: buf.byteLength };
  }, [sbfUrl]);

  return { meta, isLoading, error, planRange, fetchPage };
}

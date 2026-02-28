import { useEffect, useState, useCallback } from 'react';
import { duckdb, ensureDb, coerceBigInts } from '../lib/duckdb.js';

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

export interface ColumnStats {
  min: number;
  max: number;
}

export interface ColumnCardinality {
  distinct: number;
  values:   string[];   // sorted; empty if distinct > DROPDOWN_MAX
}

/** Columns with ≤ FACET_MAX distinct values are pulled into a facet bar */
export const FACET_MAX = 5;
/** Columns with ≤ DROPDOWN_MAX distinct values get a dropdown selector */
export const DROPDOWN_MAX = 50;

export interface QueryParams {
  filters:          Record<string, string>;
  sort?:            SortSpec | null;
  /**
   * When provided alongside active filters, the query also computes per-field
   * min/max on the filtered set (constrainedStats). Drives the Constrained
   * Reality band and Amber Alert in RangeSlider.
   */
  numericColPaths?: string[];
}

export interface QueryResult {
  rows:              Record<string, unknown>[];
  filteredCount:     number;
  /**
   * Per-field min/max derived from records that pass the active filter set.
   * Only present when numericColPaths was supplied and filters are active.
   */
  constrainedStats?: Record<string, ColumnStats>;
  error?:            string;
}

export type DuckDbStatus = 'idle' | 'loading' | 'ready' | 'error';

export type DuckDbStage =
  | 'initializing'    // booting WASM engine
  | 'loading-json'    // fetching + CREATE TABLE from JSON
  | 'analyzing'       // DESCRIBE + COUNT
  | 'statistics'      // min/max + cardinality
  | 'ready';          // done

// ── Numeric type detection ────────────────────────────────

const NUMERIC_TYPES = new Set([
  'TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'HUGEINT',
  'UTINYINT', 'USMALLINT', 'UINTEGER', 'UBIGINT',
  'FLOAT', 'DOUBLE', 'DECIMAL',
]);

export function isNumericType(type: string): boolean {
  const base = type.replace(/\(.+\)/, '').trim().toUpperCase();
  return NUMERIC_TYPES.has(base);
}

// ── Module-level table cache ──────────────────────────────

let _loadedFileId: string | null = null;
let _loadPromise:  Promise<void> | null = null;

async function ensureTable(fileId: string, getUrl: () => Promise<string>): Promise<void> {
  if (_loadedFileId === fileId) return;
  if (_loadPromise) { await _loadPromise; return; }

  _loadPromise = (async () => {
    try {
      const { db, conn } = await ensureDb();
      await conn.query(`DROP TABLE IF EXISTS result`);
      const url = await getUrl();
      await db.registerFileURL(
        'result_data.json',
        url,
        duckdb.DuckDBDataProtocol.HTTP,
        true,
      );
      await conn.query(`
        CREATE TABLE result AS
        SELECT * FROM read_json_auto('result_data.json', maximum_object_size=104857600)
      `);
      _loadedFileId = fileId;
    } finally {
      _loadPromise = null;
    }
  })();

  await _loadPromise;
}

// ── Hook ─────────────────────────────────────────────────

export function useJsonDuckDb(
  fileId: string | null,
  getUrl: (() => Promise<string>) | null,
) {
  const [status,            setStatus]            = useState<DuckDbStatus>('idle');
  const [stage,             setStage]             = useState<DuckDbStage>('initializing');
  const [columns,           setColumns]           = useState<ColumnInfo[]>([]);
  const [totalRows,         setTotalRows]         = useState(0);
  const [columnStats,       setColumnStats]       = useState<Record<string, ColumnStats>>({});
  const [columnCardinality, setColumnCardinality] = useState<Record<string, ColumnCardinality>>({});
  const [error,             setError]             = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || !getUrl) return;
    const id = fileId;
    const fn = getUrl;
    let cancelled = false;

    async function load() {
      setStatus('loading');
      setStage('initializing');
      try {
        const { conn } = await ensureDb();
        if (cancelled) return;

        setStage('loading-json');
        await ensureTable(id, fn);
        if (cancelled) return;

        setStage('analyzing');
        const [desc, count] = await Promise.all([
          conn.query(`DESCRIBE result`),
          conn.query(`SELECT COUNT(*)::INTEGER AS n FROM result`),
        ]);

        const cols: ColumnInfo[] = desc.toArray().map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return { name: String(row.column_name), type: String(row.column_type) };
        });
        const total = Number((count.toArray()[0] as Record<string, unknown>).n);

        setStage('statistics');
        // Compute min/max for numeric columns
        const numericCols = cols.filter(c => isNumericType(c.type));
        const stats: Record<string, ColumnStats> = {};

        if (numericCols.length > 0) {
          const selectParts = numericCols.flatMap(c => [
            `MIN("${c.name}")::DOUBLE AS "${c.name}_min"`,
            `MAX("${c.name}")::DOUBLE AS "${c.name}_max"`,
          ]);
          const statsResult = await conn.query(
            `SELECT ${selectParts.join(', ')} FROM result`
          );
          const statsRow = statsResult.toArray()[0] as Record<string, unknown>;
          for (const c of numericCols) {
            const min = Number(statsRow[`${c.name}_min`]);
            const max = Number(statsRow[`${c.name}_max`]);
            if (!isNaN(min) && !isNaN(max)) {
              stats[c.name] = { min, max };
            }
          }
        }

        // Compute cardinality for non-numeric columns (including STRUCT sub-fields)
        const cardinality: Record<string, ColumnCardinality> = {};
        const cardTargets: { path: string; sqlExpr: string }[] = [];

        for (const c of cols) {
          if (c.type.startsWith('STRUCT(')) {
            // Parse sub-fields from STRUCT type
            const inner = c.type.match(/^STRUCT\((.+)\)$/s)?.[1];
            if (!inner) continue;
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
              if (m && !isNumericType(m[2])) {
                cardTargets.push({ path: `${c.name}.${m[1]}`, sqlExpr: `"${c.name}".${m[1]}` });
              }
            }
          } else if (!isNumericType(c.type)) {
            cardTargets.push({ path: c.name, sqlExpr: `"${c.name}"` });
          }
        }

        // Run one COUNT(DISTINCT) query for all targets
        if (cardTargets.length > 0) {
          const selectParts = cardTargets.map(
            (t, i) => `COUNT(DISTINCT ${t.sqlExpr}::VARCHAR)::INTEGER AS c${i}`
          );
          const cardResult = await conn.query(`SELECT ${selectParts.join(', ')} FROM result`);
          const cardRow = cardResult.toArray()[0] as Record<string, unknown>;

          // For low-cardinality columns, fetch actual distinct values
          const lowCardTargets = cardTargets.filter((_, i) => {
            const n = Number(cardRow[`c${i}`]);
            return n >= 1 && n <= DROPDOWN_MAX;
          });

          const valueResults: Record<string, string[]> = {};
          // Batch value fetches in parallel
          await Promise.all(lowCardTargets.map(async (t) => {
            const vResult = await conn.query(
              `SELECT DISTINCT ${t.sqlExpr}::VARCHAR AS v FROM result ORDER BY v`
            );
            valueResults[t.path] = vResult.toArray().map(
              (r: unknown) => String((r as Record<string, unknown>).v ?? '')
            );
          }));

          for (let i = 0; i < cardTargets.length; i++) {
            const t = cardTargets[i];
            const n = Number(cardRow[`c${i}`]);
            cardinality[t.path] = {
              distinct: n,
              values: valueResults[t.path] ?? [],
            };
          }
        }

        if (!cancelled) {
          setStage('ready');
          setColumns(cols);
          setTotalRows(total);
          setColumnStats(stats);
          setColumnCardinality(cardinality);
          setStatus('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStatus('error');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [fileId, getUrl]);

  const query = useCallback(async (params: QueryParams): Promise<QueryResult | null> => {
    let conn: Awaited<ReturnType<typeof ensureDb>>['conn'];
    try { conn = (await ensureDb()).conn; } catch { return null; }

    const conditions = Object.entries(params.filters)
      .filter(([, v]) => v.trim())
      .map(([path, expr]) => {
        // Quote column name to handle SQL reserved words (end, start, etc.)
        // For struct paths like "tags.matched", quote the root and keep the accessor
        const dot = path.indexOf('.');
        const quoted = dot >= 0
          ? `"${path.slice(0, dot)}".${path.slice(dot + 1)}`
          : `"${path}"`;
        return `(${quoted} ${expr})`;
      });
    const where   = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = params.sort
      ? `ORDER BY "${params.sort.column}" ${params.sort.direction.toUpperCase()}`
      : '';

    // Build constrained-stats SELECT when filters are active and caller supplied
    // the list of numeric column paths. All three queries run in parallel.
    const conSelectParts = params.numericColPaths?.length && conditions.length > 0
      ? params.numericColPaths.flatMap(p => [
          `MIN("${p}")::DOUBLE AS "${p}_min"`,
          `MAX("${p}")::DOUBLE AS "${p}_max"`,
        ])
      : null;

    try {
      const [rows, cnt, conResult] = await Promise.all([
        conn.query(`SELECT * FROM result ${where} ${orderBy}`),
        conn.query(`SELECT COUNT(*)::INTEGER AS n FROM result ${where}`),
        conSelectParts
          ? conn.query(`SELECT ${conSelectParts.join(', ')} FROM result ${where}`)
          : Promise.resolve(null),
      ]);

      let constrainedStats: Record<string, ColumnStats> | undefined;
      if (conResult && params.numericColPaths) {
        const row = conResult.toArray()[0] as Record<string, unknown> | undefined;
        if (row) {
          constrainedStats = {};
          for (const p of params.numericColPaths) {
            const mn = Number(row[`${p}_min`]);
            const mx = Number(row[`${p}_max`]);
            if (!isNaN(mn) && !isNaN(mx)) constrainedStats[p] = { min: mn, max: mx };
          }
        }
      }

      return {
        rows:          rows.toArray().map((r: unknown) => coerceBigInts(r) as Record<string, unknown>),
        filteredCount: Number((cnt.toArray()[0] as Record<string, unknown>).n),
        constrainedStats,
      };
    } catch (e) {
      return { rows: [], filteredCount: 0, error: String(e) };
    }
  }, []);

  return { status, stage, columns, totalRows, columnStats, columnCardinality, error, query };
}

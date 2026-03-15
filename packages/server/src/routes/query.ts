/**
 * Server-side query endpoint — Arrow IPC binary transport.
 *
 * POST /:id/query
 *   Request:  JSON { filters, sort, offset, limit }
 *   Response: Binary Arrow IPC frames (zero JSON on the data path)
 *
 * Wire format:
 *   [4 bytes LE: num_tables]
 *   For each table:
 *     [4 bytes LE: table_byte_length]
 *     [table_byte_length bytes: Arrow IPC]
 *   Table order: [viewport, god_query, state_matrix?]
 *
 * The God Query table (1 row) carries:
 *   - total_rows: INT32
 *   - {col}_min / {col}_max: DOUBLE (LOO constrained stats per numeric column)
 *   - hist_{col}: MAP(INT32, UBIGINT) (LOO histogram per numeric column with variance)
 *
 * Histograms use Leave-One-Out (LOO) filtering: each column's histogram
 * reflects all active filters EXCEPT its own, enabling cross-attribute
 * correlation visibility.
 *
 * Security: column names validated against schema allowlist; all filter values
 * use $N parameterized queries. Zero SQL injection.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { histogramBucketSql, detectFormat } from '@genome-hub/shared';
import type { FilterSpec, SortSpec, DataProfile, DataProfileStats } from '@genome-hub/shared';
import { AppDataSource } from '../app_data.js';
import { GenomicFile } from '../entities/index.js';
import { asyncWrap } from '../lib/async_wrap.js';
import { resolveLocalParquet } from '../lib/parquet_cache.js';
import { getConnection } from '../lib/duckdb.js';
import { expandSchema, isNumeric, safeName, type FlatColumn } from '../lib/data_profile.js';
import type { DuckDBValue, DuckDBResult } from '@duckdb/node-api';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve the S3 key that points to the Parquet data for a file. */
function resolveParquetKey(file: GenomicFile): string | null {
  if (detectFormat(file.filename) === 'parquet') return file.s3Key;
  if (file.parquetS3Key && (file.parquetStatus === 'ready' || !file.parquetStatus))
    return file.parquetS3Key;
  return null;
}

/**
 * Execute SQL via to_arrow_ipc() and return the concatenated IPC bytes.
 * Parameters use $1, $2, ... placeholders (DuckDB node-api style).
 */
async function arrowQuery(conn: any, sql: string, params: unknown[] = []): Promise<Uint8Array> {
  const wrapped = `SELECT * FROM to_arrow_ipc((${sql}))`;
  const result = await conn.runAndReadAll(wrapped, params);
  const blobs = result.getColumns()[0];
  if (!blobs || blobs.length === 0) return new Uint8Array(0);

  let totalBytes = 0;
  const buffers: Uint8Array[] = [];
  for (const blob of blobs) {
    const bytes: Uint8Array = blob.bytes;
    buffers.push(bytes);
    totalBytes += bytes.byteLength;
  }

  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of buffers) {
    out.set(buf, offset);
    offset += buf.byteLength;
  }
  return out;
}

/**
 * Build WHERE clause + params array from validated FilterSpecs.
 * Uses $1, $2, ... placeholders for the new DuckDB API.
 */
function compileWhere(
  filters: FilterSpec[],
  colMap: Map<string, FlatColumn>,
  paramOffset = 0,
): { clause: string; params: DuckDBValue[] } {
  if (filters.length === 0) return { clause: '', params: [] };

  const conditions: string[] = [];
  const params: DuckDBValue[] = [];
  let idx = paramOffset;

  for (const f of filters) {
    const col = colMap.get(f.column)!;
    const expr = col.sqlExpr;

    switch (f.op.type) {
      case 'between':
        conditions.push(`${expr} BETWEEN $${++idx} AND $${++idx}`);
        params.push(f.op.low, f.op.high);
        break;
      case 'in':
        conditions.push(`${expr}::VARCHAR IN (${f.op.values.map(() => `$${++idx}`).join(', ')})`);
        params.push(...f.op.values);
        break;
      case 'ilike':
        conditions.push(`${expr}::VARCHAR ILIKE $${++idx}`);
        params.push(`%${f.op.pattern}%`);
        break;
    }
  }

  return { clause: `WHERE ${conditions.join(' AND ')}`, params };
}

/**
 * Build the LOO (Leave-One-Out) god query + state matrix using a CTE bitmask
 * pattern.
 *
 * Phase 1 — CTE: evaluate each filter predicate ONCE as a boolean mask column.
 *   Parameters are bound here and only here.
 *
 * Phase 2a — God query SELECT: each column's MIN/MAX uses a FILTER that ANDs
 *   every mask EXCEPT its own.  COUNT(*) uses ALL masks.
 *
 * Phase 2b — State matrix SELECT: pack all boolean masks into a single integer
 *   via bitwise shifts, GROUP BY → 2^N rows of {state, count}. Gives the
 *   client every possible filter intersection in one scan.
 *
 * Both queries share the same CTE and params — run them sequentially on the
 * same connection with the same bound params.
 */
function buildLooQueries(
  readParquet: string,
  filters: FilterSpec[],
  colMap: Map<string, FlatColumn>,
  numericCols: FlatColumn[],
  histCols: FlatColumn[],
  columnStats: Record<string, DataProfileStats>,
): { godSql: string; stateSql: string | null; params: DuckDBValue[]; maskColumns: string[]; histColNames: string[] } {
  const params: DuckDBValue[] = [];
  let idx = 0;

  // Phase 1: CTE masks — one boolean per active filter
  const maskDefs: { alias: string; column: string; expr: string }[] = [];
  for (const f of filters) {
    const col = colMap.get(f.column)!;
    const sqlExpr = col.sqlExpr;
    let predicate: string;

    switch (f.op.type) {
      case 'between':
        predicate = `${sqlExpr} BETWEEN $${++idx} AND $${++idx}`;
        params.push(f.op.low, f.op.high);
        break;
      case 'in':
        predicate = `${sqlExpr}::VARCHAR IN (${f.op.values.map(() => `$${++idx}`).join(', ')})`;
        params.push(...f.op.values);
        break;
      case 'ilike':
        predicate = `${sqlExpr}::VARCHAR ILIKE $${++idx}`;
        params.push(`%${f.op.pattern}%`);
        break;
      default:
        continue;
    }

    const maskAlias = safeName('f_' + col.name);
    maskDefs.push({ alias: maskAlias, column: f.column, expr: `(${predicate}) AS ${maskAlias}` });
  }

  const ctePreamble = maskDefs.length > 0
    ? `WITH filtered AS (SELECT *, ${maskDefs.map((m) => m.expr).join(', ')} FROM ${readParquet}) `
    : '';
  const fromClause = maskDefs.length > 0 ? 'filtered' : readParquet;

  // Phase 2a: LOO aggregates — each column excludes its own mask
  const allMasks = maskDefs.map((m) => m.alias);
  const allMasksClause = allMasks.length > 0 ? ` FILTER (WHERE ${allMasks.join(' AND ')})` : '';

  const aggregates: string[] = [
    `(COUNT(*)${allMasksClause})::INTEGER AS total_rows`,
  ];

  for (const col of numericCols) {
    const otherMasks = maskDefs
      .filter((m) => m.column !== col.name)
      .map((m) => m.alias);
    const filterClause = otherMasks.length > 0
      ? ` FILTER (WHERE ${otherMasks.join(' AND ')})`
      : '';
    aggregates.push(`(MIN(${col.sqlExpr})${filterClause})::DOUBLE AS ${safeName(col.name + '_min')}`);
    aggregates.push(`(MAX(${col.sqlExpr})${filterClause})::DOUBLE AS ${safeName(col.name + '_max')}`);
  }

  // Phase 2c: LOO histograms — native histogram() on pre-bucketed values
  const histColNames: string[] = [];
  for (const col of histCols) {
    const s = columnStats[col.name];
    const bucket = histogramBucketSql(col.sqlExpr, s.min, s.max);
    const otherMasks = maskDefs
      .filter((m) => m.column !== col.name)
      .map((m) => m.alias);
    const nullGuard = `${col.sqlExpr} IS NOT NULL`;
    const filterParts = [...otherMasks, nullGuard];
    const filterClause = ` FILTER (WHERE ${filterParts.join(' AND ')})`;
    aggregates.push(`histogram(${bucket})${filterClause} AS ${safeName('hist_' + col.name)}`);
    histColNames.push(col.name);
  }

  const godSql = `${ctePreamble}SELECT ${aggregates.join(', ')} FROM ${fromClause}`;

  // Phase 2b: State matrix — pack boolean masks into a single integer, GROUP BY
  // Only meaningful with ≥2 active filters (need at least 2 bits for correlation)
  let stateSql: string | null = null;
  const maskColumns: string[] = [];
  if (maskDefs.length >= 2) {
    const stateExpr = maskDefs
      .map((m, i) => `(${m.alias}::INTEGER << ${i})`)
      .join(' | ');
    stateSql = `${ctePreamble}SELECT (${stateExpr})::INTEGER AS filter_state, COUNT(*)::INTEGER AS cnt FROM ${fromClause} GROUP BY filter_state ORDER BY filter_state`;
    for (const m of maskDefs) maskColumns.push(m.column);
  }

  return { godSql, stateSql, params, maskColumns, histColNames };
}

/** Build ORDER BY clause from validated SortSpecs. */
function compileOrderBy(sort: SortSpec[], colMap: Map<string, FlatColumn>): string {
  if (sort.length === 0) return '';
  const parts = sort.map((s) => {
    const col = colMap.get(s.column)!;
    return `${col.sqlExpr} ${s.direction.toUpperCase()}`;
  });
  return `ORDER BY ${parts.join(', ')}`;
}

/** Write a Uint32 LE into a buffer. */
function writeU32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

// ── Route ────────────────────────────────────────────────────────────────────

router.post(
  '/:id/query',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const pqKey = resolveParquetKey(file);
    if (!pqKey) {
      res.status(409).json({ error: 'parquet not ready' });
      return;
    }

    const dataProfile: DataProfile | null = file.dataProfile;
    if (!dataProfile?.schema) {
      res.status(409).json({ error: 'data profile not ready' });
      return;
    }

    // ── Parse & validate request ─────────────────────────────────────────────

    const {
      filters = [] as FilterSpec[],
      sort = [] as SortSpec[],
      offset = 0,
      limit = 50,
      mode,
    } = req.body as {
      filters?: FilterSpec[];
      sort?: SortSpec[];
      offset?: number;
      limit?: number;
      mode?: 'preflight';
    };

    const flatCols = expandSchema(dataProfile.schema);
    const colMap = new Map(flatCols.map((c) => [c.name, c]));
    const allowedNames = new Set(flatCols.map((c) => c.name));

    for (const f of filters) {
      if (!allowedNames.has(f.column)) {
        res.status(400).json({ error: `Unknown column: ${f.column}` });
        return;
      }
    }
    for (const s of sort) {
      if (!allowedNames.has(s.column)) {
        res.status(400).json({ error: `Unknown column: ${s.column}` });
        return;
      }
      if (s.direction !== 'asc' && s.direction !== 'desc') {
        res.status(400).json({ error: `Invalid sort direction: ${s.direction}` });
        return;
      }
    }

    const clampedLimit = Math.min(Math.max(1, limit), 1000);
    const clampedOffset = Math.max(0, offset);

    // ── Build queries ──────────────────────────────────────────────────────────

    // Resolve to local disk (cached download from S3 on first access)
    const localPath = await resolveLocalParquet(pqKey);
    const conn = await getConnection();
    const safeSrc = localPath.replace(/'/g, "''");
    const readParquet = `read_parquet('${safeSrc}')`;

    // Track client disconnect so we can bail out between DuckDB queries.
    // When the client aborts (e.g. new slider position fires a new query),
    // the HTTP socket closes. Continuing to call conn.runAndReadAll() after
    // that risks a native DuckDB crash when res.write() fails mid-stream.
    let clientGone = false;
    req.on('close', () => { clientGone = true; });

    try {
      const { clause: whereClause, params: whereParams } = compileWhere(filters, colMap);
      const orderByClause = compileOrderBy(sort, colMap);

      // ── God Query: COUNT + constrained MIN/MAX ───────────────────────────

      const columnStats: Record<string, DataProfileStats> | null = dataProfile.columnStats ?? null;
      const numericCols = flatCols.filter((c) => isNumeric(c.type));
      const histCols = numericCols.filter((c) => {
        if (!columnStats) return false;
        const s = columnStats[c.name];
        return s && s.min !== s.max;
      });

      // ── Preflight mode: god query only (count + stats, no histograms) ──
      if (mode === 'preflight') {
        const { godSql, params: godParams } = buildLooQueries(
          readParquet, filters, colMap, numericCols, [], {},
        );
        if (clientGone) { conn.closeSync(); return; }
        res.setHeader('Content-Type', 'application/vnd.apache.arrow.stream');
        res.setHeader('X-Arrow-Tables', '1');
        res.setHeader('X-Hist-Columns', '');
        res.write(writeU32LE(1));
        const godBuf = await arrowQuery(conn, godSql, godParams);
        if (clientGone) { conn.closeSync(); return; }
        res.write(writeU32LE(godBuf.byteLength));
        res.write(godBuf);
        conn.closeSync();
        res.end();
        return;
      }

      const { godSql, stateSql, params: godParams, maskColumns, histColNames } = buildLooQueries(
        readParquet, filters, colMap, numericCols, histCols, columnStats!,
      );

      // ── Viewport Query ───────────────────────────────────────────────────

      const selectList = flatCols.map((c) => `${c.sqlExpr} AS ${safeName(c.name)}`).join(', ');
      const vpParamOffset = whereParams.length;
      const viewportSql =
        `SELECT ${selectList} FROM ${readParquet} ${whereClause} ${orderByClause} ` +
        `LIMIT $${vpParamOffset + 1} OFFSET $${vpParamOffset + 2}`;
      const viewportParams = [...whereParams, clampedLimit, clampedOffset];

      // ── Execute and stream: one connection, one query at a time ──────────
      // DuckDB serializes queries on a single connection — Promise.all is a
      // lie. Execute sequentially and flush each Arrow frame to the client
      // the instant DuckDB releases it.
      //
      // Between each query, check clientGone — if the client aborted, close
      // the connection cleanly and bail. Writing to a destroyed socket while
      // DuckDB's native thread is active can crash the process.

      const hasStateMatrix = stateSql !== null;
      const numTables = 2 + (hasStateMatrix ? 1 : 0);

      res.setHeader('Content-Type', 'application/vnd.apache.arrow.stream');
      res.setHeader('X-Arrow-Tables', numTables.toString());
      res.setHeader('X-Hist-Columns', histColNames.join(','));
      // Bit position → column name mapping for the state matrix
      if (hasStateMatrix) {
        res.setHeader('X-State-Columns', maskColumns.join(','));
      }

      res.write(writeU32LE(numTables));

      // 1. Viewport — paginated rows (fastest: stops at first qualifying row group)
      const viewportBuf = await arrowQuery(conn, viewportSql, viewportParams);
      if (clientGone) { conn.closeSync(); return; }
      res.write(writeU32LE(viewportBuf.byteLength));
      res.write(viewportBuf);

      // 2. God Query — count + constrained stats (full scan)
      const godBuf = await arrowQuery(conn, godSql, godParams);
      if (clientGone) { conn.closeSync(); return; }
      res.write(writeU32LE(godBuf.byteLength));
      res.write(godBuf);

      // 3. State matrix — filter intersection counts (only with ≥2 filters)
      if (hasStateMatrix && !clientGone) {
        try {
          const stateBuf = await arrowQuery(conn, stateSql!, godParams);
          if (!clientGone) {
            res.write(writeU32LE(stateBuf.byteLength));
            res.write(stateBuf);
          }
        } catch {
          if (!clientGone) res.write(writeU32LE(0));
        }
      }

      conn.closeSync();
      if (!clientGone) res.end();
    } catch (err) {
      try {
        conn.closeSync();
      } catch {}
      // Client already disconnected — nothing to report
      if (clientGone) return;
      console.error(
        JSON.stringify({
          tag: '[QUERY_FAILED]',
          fileId: file.id,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          timestamp: new Date().toISOString(),
        }),
      );
      // If headers already sent (binary streaming started), we cannot switch
      // to a JSON error response — just destroy the socket so the client
      // sees a clean connection reset instead of a corrupt partial stream.
      if (res.headersSent) {
        res.destroy();
      } else {
        res.status(500).json({ error: 'Query failed' });
      }
    }
  }),
);

// ── TSV generator — yields one line at a time, constant memory ────────────────

async function* generateTSV(result: DuckDBResult, colNames: string[]): AsyncGenerator<string> {
  yield colNames.join('\t') + '\n';
  for await (const chunk of result) {
    const numRows = chunk.rowCount;
    const numCols = colNames.length;
    for (let r = 0; r < numRows; r++) {
      const cells: string[] = [];
      for (let c = 0; c < numCols; c++) {
        const v = chunk.getColumnVector(c).getItem(r);
        cells.push(v === null || v === undefined ? '' : String(v));
      }
      yield cells.join('\t') + '\n';
    }
  }
}

// ── Export — filtered TSV download ────────────────────────────────────────────

router.post(
  '/:id/export',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const file = await repo.findOneBy({ id: req.params.id });
    if (!file) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const pqKey = resolveParquetKey(file);
    if (!pqKey) {
      res.status(409).json({ error: 'parquet not ready' });
      return;
    }

    const dataProfile: DataProfile | null = file.dataProfile;
    if (!dataProfile?.schema) {
      res.status(409).json({ error: 'data profile not ready' });
      return;
    }

    const {
      filters = [] as FilterSpec[],
      sort = [] as SortSpec[],
    } = req.body as {
      filters?: FilterSpec[];
      sort?: SortSpec[];
    };

    const flatCols = expandSchema(dataProfile.schema);
    const colMap = new Map(flatCols.map((c) => [c.name, c]));
    const allowedNames = new Set(flatCols.map((c) => c.name));

    for (const f of filters) {
      if (!allowedNames.has(f.column)) {
        res.status(400).json({ error: `Unknown column: ${f.column}` });
        return;
      }
    }
    for (const s of sort) {
      if (!allowedNames.has(s.column)) {
        res.status(400).json({ error: `Unknown column: ${s.column}` });
        return;
      }
      if (s.direction !== 'asc' && s.direction !== 'desc') {
        res.status(400).json({ error: `Invalid sort direction: ${s.direction}` });
        return;
      }
    }

    const localPath = await resolveLocalParquet(pqKey);
    const conn = await getConnection();
    const safeSrc = localPath.replace(/'/g, "''");
    const readParquet = `read_parquet('${safeSrc}')`;

    try {
      const { clause: whereClause, params: whereParams } = compileWhere(filters, colMap);
      const orderByClause = compileOrderBy(sort, colMap);
      const selectList = flatCols.map((c) => `${c.sqlExpr} AS ${safeName(c.name)}`).join(', ');

      const sql = `SELECT ${selectList} FROM ${readParquet} ${whereClause} ${orderByClause}`;
      const result = await conn.stream(sql, whereParams);
      const colNames = result.columnNames();

      const stem = file.filename.replace(/\.[^.]+$/, '');
      const hasQuery = filters.length > 0 || sort.length > 0;
      let exportName: string;
      if (hasQuery) {
        const hash = createHash('sha256').update(JSON.stringify({ filters, sort })).digest('hex').slice(0, 8);
        exportName = `${stem}_${hash}.tsv`;
      } else {
        exportName = `${stem}.tsv`;
      }

      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exportName}"`);

      // pipeline handles backpressure, client disconnect, and teardown.
      // The generator yields one TSV line at a time — constant memory.
      await pipeline(Readable.from(generateTSV(result, colNames)), res);
    } catch (err) {
      // pipeline throws on client disconnect (ERR_STREAM_PREMATURE_CLOSE) — not an error.
      if ((err as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      console.error(
        JSON.stringify({
          tag: '[EXPORT_FAILED]',
          fileId: file.id,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      }
    } finally {
      conn.closeSync();
    }
  }),
);

export default router;

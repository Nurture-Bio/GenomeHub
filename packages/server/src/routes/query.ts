/**
 * Server-side query endpoint — Arrow IPC binary transport.
 *
 * POST /:id/query
 *   Request:  JSON { filters, sort, offset, limit }
 *   Response: Binary Arrow IPC frames (zero JSON on the data path)
 *
 * Wire format:
 *   [4 bytes LE: god_table_length]
 *   [god_table_length bytes: God Query Arrow IPC]
 *   [remaining bytes: Viewport Arrow IPC]
 *
 * The God Query table (1 row) carries:
 *   - total_rows: INT32
 *   - {col}_min / {col}_max: DOUBLE (constrained stats per numeric column)
 *   - {col}_hist_bucket / {col}_hist_cnt: INT32 columns per histogram column
 *     (exactly 64 rows guaranteed via generate_series LEFT JOIN)
 *
 * Actually, to keep the God Query as a single-row table with fixed-length
 * histogram arrays, we pack histograms as separate per-column Arrow tables
 * after the God Query. The framing becomes:
 *
 *   [4 bytes LE: num_tables]
 *   For each table:
 *     [4 bytes LE: table_byte_length]
 *     [table_byte_length bytes: Arrow IPC]
 *   Table order: [viewport, god_query, hist_col_0, hist_col_1, ...]
 *
 * Security: column names validated against schema allowlist; all filter values
 * use $N parameterized queries. Zero SQL injection.
 *
 * @module
 */

import { Router } from 'express';
import { HISTOGRAM_BINS, histogramBucketSql, detectFormat } from '@genome-hub/shared';
import type { FilterSpec, SortSpec, DataProfile, DataProfileStats } from '@genome-hub/shared';
import { AppDataSource } from '../app_data.js';
import { GenomicFile } from '../entities/index.js';
import { asyncWrap } from '../lib/async_wrap.js';
import { resolveLocalParquet } from '../lib/parquet_cache.js';
import { getConnection } from '../lib/duckdb.js';
import { expandSchema, isNumeric, safeName, type FlatColumn } from '../lib/data_profile.js';

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
): { clause: string; params: unknown[] } {
  if (filters.length === 0) return { clause: '', params: [] };

  const conditions: string[] = [];
  const params: unknown[] = [];
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
    } = req.body as {
      filters?: FilterSpec[];
      sort?: SortSpec[];
      offset?: number;
      limit?: number;
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

      const godSelectParts: string[] = ['COUNT(*)::INTEGER AS total_rows'];
      for (const col of numericCols) {
        godSelectParts.push(`MIN(${col.sqlExpr})::DOUBLE AS ${safeName(col.name + '_min')}`);
        godSelectParts.push(`MAX(${col.sqlExpr})::DOUBLE AS ${safeName(col.name + '_max')}`);
      }
      const godSql = `SELECT ${godSelectParts.join(', ')} FROM ${readParquet} ${whereClause}`;

      // ── Viewport Query ───────────────────────────────────────────────────

      const selectList = flatCols.map((c) => `${c.sqlExpr} AS ${safeName(c.name)}`).join(', ');
      const vpParamOffset = whereParams.length;
      const viewportSql =
        `SELECT ${selectList} FROM ${readParquet} ${whereClause} ${orderByClause} ` +
        `LIMIT $${vpParamOffset + 1} OFFSET $${vpParamOffset + 2}`;
      const viewportParams = [...whereParams, clampedLimit, clampedOffset];

      // ── Per-column histogram queries (zero-filled via generate_series) ───

      const histQueryBuilders = histCols.map((col) => {
        const s = columnStats![col.name];
        const bucket = histogramBucketSql(col.sqlExpr, s.min, s.max);
        const nullJoin = whereClause ? 'AND' : 'WHERE';
        const sql =
          `WITH counts AS (` +
          `SELECT ${bucket} AS bucket, COUNT(*)::INTEGER AS cnt ` +
          `FROM ${readParquet} ${whereClause} ${nullJoin} ${col.sqlExpr} IS NOT NULL ` +
          `GROUP BY bucket` +
          `), all_bins AS (` +
          `SELECT generate_series AS bucket FROM generate_series(0, ${HISTOGRAM_BINS - 1})` +
          `) SELECT a.bucket::INTEGER AS bucket, COALESCE(c.cnt, 0)::INTEGER AS cnt ` +
          `FROM all_bins a LEFT JOIN counts c ON a.bucket = c.bucket ` +
          `ORDER BY a.bucket`;
        return { sql, params: [...whereParams] };
      });

      // ── Execute and stream: one connection, one query at a time ──────────
      // DuckDB serializes queries on a single connection — Promise.all is a
      // lie. Execute sequentially and flush each Arrow frame to the client
      // the instant DuckDB releases it.

      const numTables = 2 + histQueryBuilders.length;

      res.setHeader('Content-Type', 'application/vnd.apache.arrow.stream');
      res.setHeader('X-Arrow-Tables', numTables.toString());
      res.setHeader('X-Hist-Columns', histCols.map((c) => c.name).join(','));

      res.write(writeU32LE(numTables));

      // 1. Viewport — paginated rows (fastest: stops at first qualifying row group)
      const viewportBuf = await arrowQuery(conn, viewportSql, viewportParams);
      res.write(writeU32LE(viewportBuf.byteLength));
      res.write(viewportBuf);

      // 2. God Query — count + constrained stats (full scan)
      const godBuf = await arrowQuery(conn, godSql, whereParams);
      res.write(writeU32LE(godBuf.byteLength));
      res.write(godBuf);

      // 3. Histograms — one per numeric column, flushed individually
      for (const h of histQueryBuilders) {
        try {
          const histBuf = await arrowQuery(conn, h.sql, h.params);
          res.write(writeU32LE(histBuf.byteLength));
          res.write(histBuf);
        } catch {
          // Empty frame — client sees 0-length table
          res.write(writeU32LE(0));
        }
      }

      conn.closeSync();
      res.end();
    } catch (err) {
      try {
        conn.closeSync();
      } catch {}
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

export default router;

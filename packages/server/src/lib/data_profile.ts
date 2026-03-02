/**
 * data_profile — Demand-driven lazy hydration for Parquet metadata.
 *
 * The client requests specific attributes via query params. The server
 * checks JSONB, computes only what's missing from the requested set,
 * persists the updated profile, and returns.
 *
 * Three-state semantics (enforced by Lazy<T>):
 *   undefined → never attempted → trigger DuckDB compute
 *   null      → attempted and failed → do not retry (negative cache)
 *   {...}     → computed successfully → serve from cache
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │  To add a new computed attribute:                          │
 * │    1. Add to EnrichableAttributes in @genome-hub/shared    │
 * │    2. Write an enrichFoo() function in this file           │
 * │    3. Add a case to hydrateAttribute()                     │
 * └────────────────────────────────────────────────────────────┘
 *
 * @module
 */

import type {
  DataProfile,
  DataProfileStats,
  DataProfileCardinality,
  DataProfileCharLengths,
  EnrichableAttributes,
  JsonValue, JsonObject,
} from '@genome-hub/shared';
import { AppDataSource } from '../app_data.js';
import { duckdbSrc, duckdbSetup } from './storage.js';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate that a list of strings are valid enrichable attribute keys.
 * Returns only the valid keys.
 */
const VALID_KEYS = new Set<keyof EnrichableAttributes>([
  'columnStats', 'cardinality', 'charLengths', 'initialRows',
]);

/** All enrichable attribute keys — used for eager compute at upload time. */
export const ALL_KEYS: (keyof EnrichableAttributes)[] = [...VALID_KEYS];

export function validateAttributeKeys(raw: string[]): (keyof EnrichableAttributes)[] {
  return raw.filter((k): k is keyof EnrichableAttributes =>
    VALID_KEYS.has(k as keyof EnrichableAttributes)
  );
}

/**
 * Extract the base profile (schema + rowCount) from Parquet footer.
 * This is free — no data scan, just metadata reads.
 */
export async function extractBaseProfile(
  parquetS3Key: string,
): Promise<DataProfile> {
  const { session, close } = await openDuckDbSession(parquetS3Key);
  try {
    // Use DESCRIBE (logical types) instead of parquet_schema (physical types).
    // parquet_schema returns BYTE_ARRAY/INT64/group nodes — unusable by the client.
    // DESCRIBE returns VARCHAR/BIGINT/STRUCT(...) — matches client-side WASM output.
    const schemaRows = await session.query(
      `DESCRIBE SELECT * FROM read_parquet('${session.safeSrc}')`
    );
    const schema = schemaRows.map((r: any) => ({
      name: r.column_name,
      type: r.column_type,
    }));

    const countRows = await session.query(
      `SELECT COUNT(*)::INTEGER AS n FROM read_parquet('${session.safeSrc}')`
    );
    const rowCount = Number(countRows[0]?.n ?? 0);

    return { schema, rowCount, profiledAt: new Date().toISOString() };
  } finally {
    await close();
  }
}

/**
 * Hydrate requested attributes on a profile. Only computes what's missing
 * (=== undefined). Null means "attempted and failed" — never retried.
 *
 * File-level request coalescing: one DuckDB session per file at a time.
 */
export async function hydrateAttributes(
  parquetS3Key: string,
  fileId: string,
  existing: DataProfile | null,
  requestedKeys: (keyof EnrichableAttributes)[],
): Promise<DataProfile> {
  let profile = existing ?? await extractBaseProfile(parquetS3Key);

  // Fast path: all requested keys already present (not undefined)
  let missing = requestedKeys.filter(k => profile[k] === undefined);
  if (missing.length === 0) return profile;

  // If another request is computing for this file, await IT and use ITS result
  if (inflight.has(fileId)) {
    profile = await inflight.get(fileId)!;
    missing = requestedKeys.filter(k => profile[k] === undefined);
    if (missing.length === 0) return profile;
    // Fall through — the other request computed different attributes than we need
  }

  // We are the leader — compute in ONE DuckDB session, share the promise
  const promise = (async () => {
    const { session, close } = await openDuckDbSession(parquetS3Key);
    try {
      for (const key of missing) {
        await hydrateAttribute(key, session, profile);
      }
      profile.profiledAt = new Date().toISOString();
    } finally {
      await close();
    }
    return profile;
  })();

  inflight.set(fileId, promise);
  try {
    profile = await promise;
    await mergeProfileToDb(fileId, profile, missing);
    return profile;
  } finally {
    inflight.delete(fileId);
  }
}

// ── Request Coalescing ──────────────────────────────────────────────────────

/** Module-level — one in-flight computation per file. */
const inflight = new Map<string, Promise<DataProfile>>();

// ── Attribute Dispatch ──────────────────────────────────────────────────────

async function hydrateAttribute(
  key: keyof EnrichableAttributes,
  session: DuckDbSession,
  profile: DataProfile,
): Promise<void> {
  switch (key) {
    case 'columnStats':
      if (profile.columnStats !== undefined) return;
      try { profile.columnStats = await enrichColumnStats(session, profile); }
      catch { profile.columnStats = null; }
      return;
    case 'cardinality':
      if (profile.cardinality !== undefined) return;
      try { profile.cardinality = await enrichCardinality(session, profile); }
      catch { profile.cardinality = null; }
      return;
    case 'charLengths':
      if (profile.charLengths !== undefined) return;
      try { profile.charLengths = await enrichCharLengths(session, profile); }
      catch { profile.charLengths = null; }
      return;
    case 'initialRows':
      if (profile.initialRows !== undefined) return;
      try { profile.initialRows = await enrichInitialRows(session, profile); }
      catch { profile.initialRows = null; }
      return;
  }
}

// ── JSONB Deep Merge ────────────────────────────────────────────────────────

async function mergeProfileToDb(
  fileId: string,
  profile: DataProfile,
  computedKeys: (keyof EnrichableAttributes)[],
): Promise<void> {
  // Build a patch containing only the keys we just computed
  const patch: Record<string, unknown> = { profiledAt: profile.profiledAt };
  for (const key of computedKeys) {
    patch[key] = (profile as Record<string, unknown>)[key]; // null or data
  }

  await AppDataSource.query(
    `UPDATE genomic_files
     SET data_profile = COALESCE(data_profile, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(patch), fileId]
  );
}

// ── DuckDB Session ──────────────────────────────────────────────────────────

interface DuckDbSession {
  query: (sql: string) => Promise<any[]>;
  exec:  (sql: string) => Promise<void>;
  safeSrc: string;
}

async function openDuckDbSession(parquetS3Key: string): Promise<{
  session: DuckDbSession;
  close: () => Promise<void>;
}> {
  const duckdb = await import('duckdb');
  const db = new (duckdb as any).default.Database(':memory:');
  const conn = db.connect();
  const src = duckdbSrc(parquetS3Key);
  const safeSrc = src.replace(/'/g, "''");

  const query = (sql: string): Promise<any[]> =>
    new Promise((resolve, reject) => {
      conn.all(sql, (err: Error | null, rows: any[]) => {
        if (err) reject(err); else resolve(rows ?? []);
      });
    });

  const exec = (sql: string): Promise<void> =>
    new Promise((resolve, reject) => {
      conn.exec(sql, (err: Error | null) => {
        if (err) reject(err); else resolve();
      });
    });

  const setup = duckdbSetup();
  if (setup) await exec(setup);

  return {
    session: { query, exec, safeSrc },
    close: () => new Promise<void>(resolve => db.close(() => resolve())),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const LOW_CARDINALITY_MAX = 50;

const NUMERIC_TYPES = new Set([
  'TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'HUGEINT',
  'UTINYINT', 'USMALLINT', 'UINTEGER', 'UBIGINT',
  'FLOAT', 'DOUBLE', 'DECIMAL',
]);

function isNumeric(duckdbType: string): boolean {
  const base = duckdbType.split('(')[0].toUpperCase();
  return NUMERIC_TYPES.has(base);
}

function safeName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// ── STRUCT expansion ─────────────────────────────────────────────────────────

interface FlatColumn {
  name: string;     // e.g. "tags.offset" — used as key in results
  type: string;     // e.g. "BIGINT"
  sqlExpr: string;  // e.g. "tags"."offset" — used in SQL
}

/** Parse STRUCT(foo VARCHAR, bar BIGINT, ...) into field list. */
function parseStructFields(structType: string): { name: string; type: string }[] {
  const inner = structType.match(/^STRUCT\((.+)\)$/s)?.[1];
  if (!inner) return [];
  const fields: { name: string; type: string }[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) {
      fields.push(parseField(inner.slice(start, i).trim()));
      start = i + 1;
    }
  }
  fields.push(parseField(inner.slice(start).trim()));
  return fields;
}

function parseField(s: string): { name: string; type: string } {
  const m = s.match(/^"?(\w+)"?\s+(.+)$/);
  return m ? { name: m[1], type: m[2] } : { name: s, type: 'VARCHAR' };
}

/** Expand STRUCT columns into flat dot-notation columns with SQL expressions. */
function expandSchema(schema: { name: string; type: string }[]): FlatColumn[] {
  const result: FlatColumn[] = [];
  for (const col of schema) {
    if (col.type.startsWith('STRUCT(')) {
      for (const f of parseStructFields(col.type)) {
        result.push({
          name: `${col.name}.${f.name}`,
          type: f.type,
          sqlExpr: `${safeName(col.name)}.${safeName(f.name)}`,
        });
      }
    } else {
      result.push({ name: col.name, type: col.type, sqlExpr: safeName(col.name) });
    }
  }
  return result;
}

// ── Enrichment Functions ────────────────────────────────────────────────────

async function enrichColumnStats(
  session: DuckDbSession,
  profile: DataProfile,
): Promise<Record<string, DataProfileStats>> {
  const flatCols = expandSchema(profile.schema);
  const numericCols = flatCols.filter(c => isNumeric(c.type));
  if (numericCols.length === 0 || profile.rowCount === 0) return {};

  const selectParts = numericCols.flatMap(col => [
    `MIN(${col.sqlExpr}) AS "min_${col.name}"`,
    `MAX(${col.sqlExpr}) AS "max_${col.name}"`,
    `SUM(CASE WHEN ${col.sqlExpr} IS NULL THEN 1 ELSE 0 END) AS "nc_${col.name}"`,
  ]);

  const rows = await session.query(
    `SELECT ${selectParts.join(', ')} FROM read_parquet('${session.safeSrc}')`
  );
  if (rows.length === 0) return {};

  const row = rows[0];
  const result: Record<string, DataProfileStats> = {};
  for (const col of numericCols) {
    result[col.name] = {
      min:       Number(row[`min_${col.name}`]),
      max:       Number(row[`max_${col.name}`]),
      nullCount: Number(row[`nc_${col.name}`]),
    };
  }
  return result;
}

async function enrichCardinality(
  session: DuckDbSession,
  profile: DataProfile,
): Promise<Record<string, DataProfileCardinality>> {
  const flatCols = expandSchema(profile.schema);
  if (flatCols.length === 0 || profile.rowCount === 0) return {};

  const selectParts = flatCols.map(col =>
    `COUNT(DISTINCT ${col.sqlExpr}) AS "cd_${col.name}"`
  );

  const rows = await session.query(
    `SELECT ${selectParts.join(', ')} FROM read_parquet('${session.safeSrc}')`
  );
  if (rows.length === 0) return {};

  const row = rows[0];
  const result: Record<string, DataProfileCardinality> = {};
  for (const col of flatCols) {
    result[col.name] = { distinct: Number(row[`cd_${col.name}`]) };
  }

  // Top values for low-cardinality columns
  const lowCard = flatCols.filter(c => {
    const d = result[c.name]?.distinct ?? 0;
    return d > 0 && d <= LOW_CARDINALITY_MAX;
  });

  for (const col of lowCard) {
    const topRows = await session.query(
      `SELECT ${col.sqlExpr}::VARCHAR AS value, COUNT(*) AS cnt
       FROM read_parquet('${session.safeSrc}')
       WHERE ${col.sqlExpr} IS NOT NULL
       GROUP BY ${col.sqlExpr}
       ORDER BY cnt DESC
       LIMIT ${LOW_CARDINALITY_MAX}`
    );
    result[col.name].topValues = topRows.map(r => ({
      value: String(r.value),
      count: Number(r.cnt),
    }));
  }

  return result;
}

/** Max serialized payload for initialRows: 64 KB. Rows beyond this are dropped. */
const INITIAL_ROWS_BYTE_BUDGET = 64 * 1024;
const INITIAL_ROWS_MAX = 100;

async function enrichInitialRows(
  session: DuckDbSession,
  profile: DataProfile,
): Promise<JsonObject[]> {
  if (profile.rowCount === 0) return [];
  const flatCols = expandSchema(profile.schema);
  const selectList = flatCols.length
    ? flatCols.map(c => `${c.sqlExpr} AS "${c.name}"`).join(', ')
    : '*';
  const rows = await session.query(
    `SELECT ${selectList} FROM read_parquet('${session.safeSrc}') LIMIT ${INITIAL_ROWS_MAX}`
  );
  // Coerce BigInt → Number, enforce byte budget (break at row boundary)
  const result: JsonObject[] = [];
  let bytes = 2; // account for opening '[' and closing ']'
  for (const r of rows) {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      out[k] = typeof v === 'bigint' ? Number(v) : v as JsonValue;
    }
    const rowBytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
    if (bytes + rowBytes + 1 > INITIAL_ROWS_BYTE_BUDGET && result.length > 0) break;
    result.push(out);
    bytes += rowBytes + 1; // +1 for comma separator
  }
  return result;
}

async function enrichCharLengths(
  session: DuckDbSession,
  profile: DataProfile,
): Promise<Record<string, DataProfileCharLengths>> {
  const flatCols = expandSchema(profile.schema);
  if (flatCols.length === 0 || profile.rowCount === 0) return {};

  const selectParts = flatCols.flatMap(col => [
    `MIN(LENGTH(${col.sqlExpr}::VARCHAR)) AS "cmin_${col.name}"`,
    `MAX(LENGTH(${col.sqlExpr}::VARCHAR)) AS "cmax_${col.name}"`,
  ]);

  const rows = await session.query(
    `SELECT ${selectParts.join(', ')} FROM read_parquet('${session.safeSrc}')`
  );
  if (rows.length === 0) return {};

  const row = rows[0];
  const result: Record<string, DataProfileCharLengths> = {};
  for (const col of flatCols) {
    const mn = Number(row[`cmin_${col.name}`]);
    const mx = Number(row[`cmax_${col.name}`]);
    if (!isNaN(mn) && !isNaN(mx)) result[col.name] = { min: mn, max: mx };
  }
  return result;
}

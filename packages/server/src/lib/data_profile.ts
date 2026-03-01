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
} from '@genome-hub/shared';
import { AppDataSource } from '../app_data.js';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate that a list of strings are valid enrichable attribute keys.
 * Returns only the valid keys.
 */
const VALID_KEYS = new Set<keyof EnrichableAttributes>([
  'columnStats', 'cardinality', 'charLengths',
]);

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
  bucket: string,
  parquetS3Key: string,
): Promise<DataProfile> {
  const { session, close } = await openDuckDbSession(bucket, parquetS3Key);
  try {
    const schemaRows = await session.query(
      `SELECT name, type FROM parquet_schema('${session.safeSrc}') WHERE name != 'duckdb_schema'`
    );
    const schema = schemaRows.map(r => ({ name: r.name, type: r.type }));

    const countRows = await session.query(
      `SELECT num_rows FROM parquet_file_metadata('${session.safeSrc}')`
    );
    const rowCount = countRows.reduce((sum: number, r: any) => sum + Number(r.num_rows), 0);

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
  bucket: string,
  parquetS3Key: string,
  fileId: string,
  existing: DataProfile | null,
  requestedKeys: (keyof EnrichableAttributes)[],
): Promise<DataProfile> {
  let profile = existing ?? await extractBaseProfile(bucket, parquetS3Key);

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
    const { session, close } = await openDuckDbSession(bucket, parquetS3Key);
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

async function openDuckDbSession(bucket: string, parquetS3Key: string): Promise<{
  session: DuckDbSession;
  close: () => Promise<void>;
}> {
  const duckdb = await import('duckdb');
  const db = new (duckdb as any).default.Database(':memory:');
  const conn = db.connect();
  const src = `s3://${bucket}/${parquetS3Key}`;
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

  await exec('INSTALL httpfs; LOAD httpfs; INSTALL aws; LOAD aws; CALL load_aws_credentials();');

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

// ── Enrichment Functions ────────────────────────────────────────────────────

async function enrichColumnStats(
  session: DuckDbSession,
  profile: DataProfile,
): Promise<Record<string, DataProfileStats>> {
  const numericCols = profile.schema.filter(c => isNumeric(c.type));
  if (numericCols.length === 0 || profile.rowCount === 0) return {};

  const selectParts = numericCols.flatMap(col => {
    const s = safeName(col.name);
    return [
      `MIN(${s}) AS "min_${col.name}"`,
      `MAX(${s}) AS "max_${col.name}"`,
      `SUM(CASE WHEN ${s} IS NULL THEN 1 ELSE 0 END) AS "nc_${col.name}"`,
    ];
  });

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
  if (profile.schema.length === 0 || profile.rowCount === 0) return {};

  const cols = profile.schema;
  const selectParts = cols.map(col =>
    `COUNT(DISTINCT ${safeName(col.name)}) AS "cd_${col.name}"`
  );

  const rows = await session.query(
    `SELECT ${selectParts.join(', ')} FROM read_parquet('${session.safeSrc}')`
  );
  if (rows.length === 0) return {};

  const row = rows[0];
  const result: Record<string, DataProfileCardinality> = {};
  for (const col of cols) {
    result[col.name] = { distinct: Number(row[`cd_${col.name}`]) };
  }

  // Top values for low-cardinality columns
  const lowCard = cols.filter(c => {
    const d = result[c.name]?.distinct ?? 0;
    return d > 0 && d <= LOW_CARDINALITY_MAX;
  });

  for (const col of lowCard) {
    const s = safeName(col.name);
    const topRows = await session.query(
      `SELECT ${s}::VARCHAR AS value, COUNT(*) AS cnt
       FROM read_parquet('${session.safeSrc}')
       WHERE ${s} IS NOT NULL
       GROUP BY ${s}
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

async function enrichCharLengths(
  session: DuckDbSession,
  profile: DataProfile,
): Promise<Record<string, DataProfileCharLengths>> {
  if (profile.schema.length === 0 || profile.rowCount === 0) return {};

  const selectParts = profile.schema.flatMap(col => {
    const s = safeName(col.name);
    return [
      `MIN(LENGTH(${s}::VARCHAR)) AS "cmin_${col.name}"`,
      `MAX(LENGTH(${s}::VARCHAR)) AS "cmax_${col.name}"`,
    ];
  });

  const rows = await session.query(
    `SELECT ${selectParts.join(', ')} FROM read_parquet('${session.safeSrc}')`
  );
  if (rows.length === 0) return {};

  const row = rows[0];
  const result: Record<string, DataProfileCharLengths> = {};
  for (const col of profile.schema) {
    const mn = Number(row[`cmin_${col.name}`]);
    const mx = Number(row[`cmax_${col.name}`]);
    if (!isNaN(mn) && !isNaN(mx)) result[col.name] = { min: mn, max: mx };
  }
  return result;
}

/**
 * File → Parquet conversion via DuckDB native S3-to-S3.
 *
 * Uses DuckDB's httpfs + aws extensions to read files directly from S3
 * and write Parquet back to S3 — zero Node.js I/O, zero temp files.
 * ZSTD compression + 122,880 row groups (Parquet default).
 *
 * @module
 */

import { duckdbSrc, ensureDir, isLocal } from './storage.js';

const MAX_CONVERSION_BYTES = 1.5 * 1024 * 1024 * 1024;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
interface ConversionContext {
  fileId: string;
  s3Key: string;
  parquetS3Key: string;
  format: string;
  fileSizeBytes?: number;
}

function logConversionError(ctx: ConversionContext, err: Error, extra?: Record<string, unknown>) {
  const entry = {
    tag: '[DUCKDB_CONVERSION_ERROR]',
    fileId: ctx.fileId,
    s3Key: ctx.s3Key,
    parquetS3Key: ctx.parquetS3Key,
    fileSizeBytes: ctx.fileSizeBytes ?? null,
    error: err.message,
    stack: err.stack ?? null,
    timestamp: new Date().toISOString(),
    ...extra,
  };
  console.error(JSON.stringify(entry));
}

/**
 * Convert a file in S3 to Parquet via DuckDB's native S3 support.
 * Retries up to 3 times with exponential backoff (1s, 4s, 16s).
 */
export async function convertToParquet(
  s3Key: string,
  parquetS3Key: string,
  format: string,
  sizeBytes?: number,
  fileId?: string,
): Promise<void> {
  const ctx: ConversionContext = {
    fileId: fileId ?? 'unknown',
    s3Key,
    parquetS3Key,
    format,
    fileSizeBytes: sizeBytes,
  };

  if (sizeBytes && sizeBytes > MAX_CONVERSION_BYTES) {
    const err = new Error(`File too large for Parquet conversion (${sizeBytes} bytes)`);
    logConversionError(ctx, err, { reason: 'size_exceeded', maxBytes: MAX_CONVERSION_BYTES });
    throw err;
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await runDuckDbS3Conversion(ctx);
      console.log(
        JSON.stringify({
          tag: '[DUCKDB_CONVERSION_OK]',
          fileId: ctx.fileId,
          s3Key: ctx.s3Key,
          fileSizeBytes: ctx.fileSizeBytes ?? null,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logConversionError(ctx, lastError, {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
      });
      if (attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_BASE_MS * Math.pow(4, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error('Parquet conversion failed');
}

function duckDbReader(src: string, format: string): string {
  const safeSrc = src.replace(/'/g, "''");
  switch (format) {
    case 'json':
      return `read_json_auto('${safeSrc}', maximum_object_size=104857600)`;
    case 'csv':
      return `read_csv_auto('${safeSrc}')`;
    case 'tsv':
      return `read_csv_auto('${safeSrc}', delim='\\t')`;
    case 'bed':
      return `read_csv_auto('${safeSrc}', delim='\\t', header=false)`;
    case 'vcf':
      return `read_csv_auto('${safeSrc}', delim='\\t', comment='#')`;
    case 'gff':
    case 'gtf':
      return `read_csv_auto('${safeSrc}', delim='\\t', comment='#', header=false)`;
    case 'bam':
    case 'sam':
    case 'cram':
      return `read_bam('${safeSrc}')`;
    default:
      return `read_csv_auto('${safeSrc}')`;
  }
}

async function runDuckDbS3Conversion(ctx: ConversionContext): Promise<void> {
  const { getConnection } = await import('./duckdb.js');
  const conn = await getConnection();

  try {
    const src = duckdbSrc(ctx.s3Key);
    const dst = duckdbSrc(ctx.parquetS3Key);
    const safeDst = dst.replace(/'/g, "''");

    if (isLocal) await ensureDir(ctx.parquetS3Key);

    const reader = duckDbReader(src, ctx.format);
    const sql =
      `COPY (SELECT * FROM ${reader}) ` +
      `TO '${safeDst}' (FORMAT PARQUET, ROW_GROUP_SIZE 122880, COMPRESSION 'ZSTD')`;

    await conn.run(sql);
  } finally {
    conn.closeSync();
  }
}

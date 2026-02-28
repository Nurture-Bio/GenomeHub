/**
 * JSON → Parquet conversion via DuckDB native S3-to-S3.
 *
 * Uses DuckDB's httpfs + aws extensions to read JSON directly from S3
 * and write Parquet back to S3 — zero Node.js I/O, zero temp files.
 * ZSTD compression + 122,880 row groups (Parquet default).
 *
 * @module
 */

const MAX_JSON_BYTES = 1.5 * 1024 * 1024 * 1024;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const CONVERSION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

interface ConversionContext {
  fileId: string;
  bucket: string;
  s3Key: string;
  parquetS3Key: string;
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
 * Convert a JSON file in S3 to Parquet via DuckDB's native S3 support.
 * Retries up to 3 times with exponential backoff (1s, 4s, 16s).
 */
export async function convertJsonToParquet(
  bucket: string,
  s3Key: string,
  parquetS3Key: string,
  sizeBytes?: number,
  fileId?: string,
): Promise<void> {
  const ctx: ConversionContext = {
    fileId: fileId ?? 'unknown',
    bucket,
    s3Key,
    parquetS3Key,
    fileSizeBytes: sizeBytes,
  };

  if (sizeBytes && sizeBytes > MAX_JSON_BYTES) {
    const err = new Error(`File too large for Parquet conversion (${sizeBytes} bytes)`);
    logConversionError(ctx, err, { reason: 'size_exceeded', maxBytes: MAX_JSON_BYTES });
    throw err;
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await runDuckDbS3Conversion(ctx);
      console.log(JSON.stringify({
        tag: '[DUCKDB_CONVERSION_OK]',
        fileId: ctx.fileId,
        s3Key: ctx.s3Key,
        fileSizeBytes: ctx.fileSizeBytes ?? null,
        timestamp: new Date().toISOString(),
      }));
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logConversionError(ctx, lastError, {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
      });
      if (attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_BASE_MS * Math.pow(4, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error('Parquet conversion failed');
}

async function runDuckDbS3Conversion(ctx: ConversionContext): Promise<void> {
  const duckdb = await import('duckdb');
  const db = new (duckdb as any).default.Database(':memory:');

  try {
    const conn = db.connect();
    const src = `s3://${ctx.bucket}/${ctx.s3Key}`;
    const dst = `s3://${ctx.bucket}/${ctx.parquetS3Key}`;
    const safeSrc = src.replace(/'/g, "''");
    const safeDst = dst.replace(/'/g, "''");

    const sql = `
      INSTALL httpfs; LOAD httpfs;
      INSTALL aws; LOAD aws;
      CALL load_aws_credentials();
      COPY (
        SELECT * FROM read_json_auto('${safeSrc}', maximum_object_size=104857600)
      ) TO '${safeDst}' (FORMAT PARQUET, ROW_GROUP_SIZE 122880, COMPRESSION 'ZSTD');
    `;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`DuckDB conversion timed out after ${CONVERSION_TIMEOUT_MS / 1000}s`);
        logConversionError(ctx, err, { reason: 'timeout' });
        reject(err);
      }, CONVERSION_TIMEOUT_MS);

      conn.exec(sql, (err: Error | null) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    // Always close the native DuckDB database to prevent zombie threads / memory leaks
    await new Promise<void>(resolve => db.close(() => resolve()));
  }
}

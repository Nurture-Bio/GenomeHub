# Parquet Deployment Hardening Design

## Problem

The Parquet preview pipeline has several deployment pitfalls that will cause failures in production:

1. DuckDB native module won't compile on Alpine Linux (musl libc)
2. Server buffers entire JSON files into Node.js heap for conversion — wastes memory, disk, and I/O when DuckDB has native S3 support
3. CloudFront sends `require-corp` COEP header but S3 presigned URLs lack CORP headers — DuckDB WASM range requests will be blocked
4. Plain CloudFront paths bypass the application's authorization layer
5. Fire-and-forget conversion has no retry and can poll "converting" forever
6. Client shows misleading "Converting" label during preview load
7. No loading feedback when DuckDB executes network-bound queries (filter/sort changes)

## Design

### 1. Docker: Alpine to Debian Slim

Change `FROM node:22-alpine` to `FROM node:22-slim`. Replace `apk add` with `apt-get install` for build tools. DuckDB prebuilt binaries work out of the box on glibc, eliminating native compilation risk.

### 2. DuckDB Native S3-to-S3 Conversion

Eliminate all Node.js I/O. No `getObject`, no temp files, no `putObjectStream`. The `lib/parquet.ts` module runs a single DuckDB SQL statement that reads JSON directly from S3 and writes Parquet directly to S3, entirely in C++:

```sql
INSTALL httpfs; LOAD httpfs;
INSTALL aws; LOAD aws;
CALL load_aws_credentials();

COPY (SELECT * FROM read_json_auto('s3://{bucket}/{jsonKey}'))
TO 's3://{bucket}/{parquetKey}'
(FORMAT PARQUET, ROW_GROUP_SIZE 122880, COMPRESSION 'ZSTD');
```

On ECS, `load_aws_credentials()` picks up the IAM task role automatically via the ECS metadata endpoint. Zero temp files, zero Node heap allocation, native C++ network speeds. Server memory stays flat — Node just dispatches the SQL and waits for the callback.

### 3. CloudFront Signed URLs for Parquet

Add S3 bucket as a second CloudFront origin with OAC (Origin Access Control). Add a CloudFront behavior for `/parquet/*` that forwards `Range` and `If-Range` headers to the S3 origin.

CDK generates a CloudFront key pair (public key + key group) and stores the private key in SSM Parameter Store. The server's `/api/files/:id/parquet-url` endpoint signs a CloudFront URL using `@aws-sdk/cloudfront-signer`, returning a time-limited signed URL on the same origin.

This achieves:
- Same-origin eliminates COEP/CORP issues entirely
- Signed URL preserves authorization — only authenticated users who hit the API get a valid URL
- CloudFront caches Parquet row groups at edge for fast subsequent range requests

### 4. Conversion Retry with Backoff

Add `parquetStatus` column to GenomicFile entity: `'pending' | 'converting' | 'ready' | 'failed'`.

- On upload complete: set `parquetStatus = 'converting'`
- On success: set `parquetStatus = 'ready'`, populate `parquetS3Key`
- On failure: retry up to 3 times with exponential backoff (1s, 4s, 16s), then set `parquetStatus = 'failed'`
- `/api/files/:id/parquet-url` returns the actual `parquetStatus` instead of inferring from null `parquetS3Key`
- Client falls back to Strand preview on `'failed'`

### 5. ECS Task: 4GB Memory

Bump `memoryLimitMiB` to 4096 for DuckDB's internal C++ processing headroom during conversion.

### 6. Loading Step Labels

Fix misleading "Converting" label in ParquetPreview.tsx to "Preparing" — by the time the user clicks preview, conversion is usually already done; this step is just waiting for the server to confirm readiness.

### 7. Query Loading State (isQuerying + Skeleton Shimmer)

`useParquetPreview.ts` must return an `isQuerying: boolean` that is `true` whenever DuckDB WASM is executing a query that requires a network scan — specifically when `applyFilters` triggers a new `WHERE`/`ORDER BY` that invalidates the row cache. Set `true` before the query, `false` when results arrive.

`ParquetPreview.tsx` must use this `isQuerying` state to render a skeleton shimmer overlay on the data grid. The table structure (headers, sidebar, column widths) stays stable and visible — only the row content area shimmers. This prevents layout shift and communicates that new data is being fetched over the network.

## Files to Modify

| File | Change |
|------|--------|
| `Dockerfile` | `node:22-slim`, `apt-get install` for build tools |
| `packages/server/src/lib/parquet.ts` | Rewrite: DuckDB S3-to-S3 via httpfs/aws extensions, retry with backoff |
| `packages/server/src/entities/index.ts` | Add `parquetStatus` column |
| `packages/server/src/migrations/014_parquet_status.sql` | New migration for `parquet_status` column |
| `packages/server/src/routes/uploads.ts` | Set `parquetStatus` on upload complete |
| `packages/server/src/routes/files.ts` | Return CloudFront signed URL, use `parquetStatus` |
| `packages/server/package.json` | Add `@aws-sdk/cloudfront-signer` |
| `packages/infra/stack.ts` | OAC origin, `/parquet/*` behavior, key pair + key group, SSM parameter for private key, 4GB task memory |
| `packages/client/src/hooks/useParquetPreview.ts` | Handle CloudFront signed URL, handle `'failed'` status, return `isQuerying` boolean |
| `packages/client/src/components/ParquetPreview.tsx` | Fix step labels, skeleton shimmer overlay when `isQuerying` is true |

## Files Eliminated from Pipeline

- No temp files on disk during conversion
- `getObject` in `s3.ts` may become dead code (verify no other callers)

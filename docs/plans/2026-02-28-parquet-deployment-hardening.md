# Parquet Deployment Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the Parquet preview pipeline for production: DuckDB S3-to-S3 conversion, CloudFront signed URLs, retry logic, and query-state skeleton shimmer.

**Architecture:** DuckDB's native `httpfs`/`aws` extensions read JSON directly from S3 and write Parquet back to S3 — zero Node.js I/O. CloudFront proxies Parquet files from S3 via OAC, with signed URLs for authorization. Client shows skeleton shimmer during network-bound DuckDB queries.

**Tech Stack:** DuckDB Node (httpfs/aws extensions), AWS CDK (CloudFront OAC, signed URLs, SSM), `@aws-sdk/cloudfront-signer`, React + DuckDB WASM.

---

### Task 1: Dockerfile — Alpine to Debian Slim

**Files:**
- Modify: `Dockerfile`

**Step 1: Change base image and build tools**

Replace Alpine with Debian slim. DuckDB prebuilt binaries work on glibc without native compilation.

In `Dockerfile`, change:
```dockerfile
# Line 1
FROM node:22-alpine AS base
```
to:
```dockerfile
FROM node:22-slim AS base
```

Change:
```dockerfile
# Line 6
RUN apk add --no-cache python3 make g++
```
to:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
```

Change the production stage:
```dockerfile
# Line 34
FROM node:22-alpine AS production
```
to:
```dockerfile
FROM node:22-slim AS production
```

**Step 2: Verify Docker build**

Run: `docker build -t genomehub:test .`

Expected: Build completes. `npm ci` installs duckdb without native compilation errors.

**Step 3: Commit**

```bash
git add Dockerfile
git commit -m "chore: switch Docker from Alpine to Debian slim for duckdb compatibility"
```

---

### Task 2: Migration + Entity — parquetStatus Column

**Files:**
- Create: `packages/server/src/migrations/014_parquet_status.sql`
- Modify: `packages/server/src/entities/index.ts`

**Step 1: Create migration**

Create `packages/server/src/migrations/014_parquet_status.sql`:
```sql
ALTER TABLE genomic_files ADD COLUMN IF NOT EXISTS parquet_status TEXT;
```

**Step 2: Add column to GenomicFile entity**

In `packages/server/src/entities/index.ts`, add after the `parquetS3Key` column (line ~285):

```typescript
  /** Parquet conversion status: pending → converting → ready | failed */
  @Column({ name: 'parquet_status', type: 'text', nullable: true })
  parquetStatus!: string | null;
```

**Step 3: Verify server builds**

Run: `npm run build -w packages/server`

Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add packages/server/src/migrations/014_parquet_status.sql packages/server/src/entities/index.ts
git commit -m "feat: add parquet_status column to GenomicFile entity"
```

---

### Task 3: Rewrite parquet.ts — DuckDB S3-to-S3 + Retry

**Files:**
- Modify: `packages/server/src/lib/parquet.ts`

DuckDB's native `httpfs` and `aws` extensions read JSON from S3 and write Parquet to S3 entirely in C++. No temp files, no Node.js streams, no heap allocation. On ECS, `load_aws_credentials()` picks up the IAM task role automatically.

**Step 1: Rewrite parquet.ts**

Replace the entire file content:

```typescript
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

/**
 * Convert a JSON file in S3 to Parquet via DuckDB's native S3 support.
 *
 * @param bucket       S3 bucket name
 * @param s3Key        Source JSON S3 key
 * @param parquetS3Key Destination Parquet S3 key
 * @param sizeBytes    Known file size (skip conversion if > MAX_JSON_BYTES)
 */
export async function convertJsonToParquet(
  bucket: string,
  s3Key: string,
  parquetS3Key: string,
  sizeBytes?: number,
): Promise<void> {
  if (sizeBytes && sizeBytes > MAX_JSON_BYTES) {
    throw new Error(`File too large for Parquet conversion (${sizeBytes} bytes)`);
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await runDuckDbS3Conversion(bucket, s3Key, parquetS3Key);
      console.log(`Parquet conversion complete: s3://${bucket}/${s3Key} → s3://${bucket}/${parquetS3Key}`);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`Parquet conversion attempt ${attempt + 1}/${MAX_RETRIES} failed:`, lastError.message);
      if (attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_BASE_MS * Math.pow(4, attempt); // 1s, 4s, 16s
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error('Parquet conversion failed');
}

async function runDuckDbS3Conversion(
  bucket: string,
  s3Key: string,
  parquetS3Key: string,
): Promise<void> {
  const duckdb = await import('duckdb');
  return new Promise((resolve, reject) => {
    const db = new (duckdb as any).default.Database(':memory:');
    const conn = db.connect();

    const src = `s3://${bucket}/${s3Key}`;
    const dst = `s3://${bucket}/${parquetS3Key}`;

    // Escape single quotes in S3 paths
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

    conn.exec(sql, (err: Error | null) => {
      db.close(() => {});
      if (err) reject(err);
      else resolve();
    });
  });
}
```

Key changes from the old version:
- Removed all imports: `tmpdir`, `join`, `randomUUID`, `writeFile`, `unlink`, `createReadStream`, `getObject`, `putObjectStream`
- Uses `conn.exec()` (not `conn.run()`) because we execute multiple SQL statements
- `convertJsonToParquet` now takes `bucket` as first arg (needed for S3 URI construction)
- Retry logic with exponential backoff: 1s, 4s, 16s

**Step 2: Update uploads.ts caller**

In `packages/server/src/routes/uploads.ts`, the fire-and-forget call (lines ~102-109) passes `bucket`:

Find the import:
```typescript
import { convertJsonToParquet } from '../lib/parquet.js';
```

Keep it. Now find the fire-and-forget block and update it to:

```typescript
    // Fire-and-forget: convert JSON to Parquet sidecar
    const file = await repo.findOneBy({ id: fileId });
    if (file && file.filename.toLowerCase().endsWith('.json')) {
      const parquetKey = file.s3Key + '.parquet';
      await repo.update(fileId, { parquetStatus: 'converting' });

      convertJsonToParquet(BUCKET, file.s3Key, parquetKey, Number(actualSize))
        .then(() => repo.update(fileId, { parquetS3Key: parquetKey, parquetStatus: 'ready' }))
        .catch(err => {
          console.error('Parquet conversion failed:', err);
          repo.update(fileId, { parquetStatus: 'failed' }).catch(() => {});
        });
    }
```

Add `BUCKET` import at the top of uploads.ts:
```typescript
import { BUCKET } from '../lib/s3.js';
```

**Step 3: Verify server builds**

Run: `npm run build -w packages/server`

Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add packages/server/src/lib/parquet.ts packages/server/src/routes/uploads.ts
git commit -m "feat: rewrite parquet conversion to use DuckDB native S3-to-S3 with retry"
```

---

### Task 4: CDK Infrastructure — CloudFront OAC + Signed URLs + 4GB

**Files:**
- Modify: `packages/infra/stack.ts`

This task adds: S3 origin with OAC, `/parquet/*` behavior with signed URLs, RSA key pair for CloudFront signing, SSM parameter for the private key, and bumps ECS memory to 4GB.

**Step 1: Generate RSA key pair for CloudFront signing**

Run this once locally to create the key pair:
```bash
openssl genrsa -out /tmp/cf-private-key.pem 2048
openssl rsa -in /tmp/cf-private-key.pem -pubout -out /tmp/cf-public-key.pem
```

Store the private key in SSM Parameter Store:
```bash
aws ssm put-parameter \
  --name /genome-hub/cloudfront-private-key \
  --type SecureString \
  --value "$(cat /tmp/cf-private-key.pem)" \
  --region us-west-2
```

Note the public key PEM content — you'll paste it into stack.ts.

**Step 2: Update stack.ts imports**

At the top of `packages/infra/stack.ts`, verify these imports exist (add if missing):
```typescript
import * as ssm     from 'aws-cdk-lib/aws-ssm';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
```

**Step 3: Add CloudFront public key + key group**

After the `coopCoepHeaders` block (line ~247) and before `const albOrigin`, add:

```typescript
    // ── CloudFront signing key for Parquet URLs ─────────────
    const cfPublicKey = new cloudfront.PublicKey(this, 'ParquetSigningKey', {
      encodedKey: [
        '-----BEGIN PUBLIC KEY-----',
        // Paste the base64 lines from /tmp/cf-public-key.pem here
        '-----END PUBLIC KEY-----',
      ].join('\n'),
    });

    const cfKeyGroup = new cloudfront.KeyGroup(this, 'ParquetKeyGroup', {
      items: [cfPublicKey],
    });
```

**Step 4: Add S3 origin with OAC**

After the `albOrigin` line (line ~251), add:

```typescript
    const s3Origin = origins.S3BucketV2Origin.withOriginAccessControl(bucket);
```

**Step 5: Add `/parquet/*` behavior to the distribution**

In the `Distribution` construct (line ~253), add `additionalBehaviors` after `defaultBehavior`:

```typescript
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin:                 albOrigin,
        viewerProtocolPolicy:   cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy:            noCacheWithCookies,
        allowedMethods:         cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods:          cloudfront.CachedMethods.CACHE_GET_HEAD,
        originRequestPolicy:    cloudfront.OriginRequestPolicy.ALL_VIEWER,
        responseHeadersPolicy:  coopCoepHeaders,
      },
      additionalBehaviors: {
        '/parquet/*': {
          origin:               s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy:          cloudfront.CachePolicy.CACHING_OPTIMIZED,
          allowedMethods:       cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods:        cloudfront.CachedMethods.CACHE_GET_HEAD,
          responseHeadersPolicy: coopCoepHeaders,
          trustedKeyGroups:     [cfKeyGroup],
        },
      },
    });
```

Notes:
- `CACHING_OPTIMIZED` caches aggressively (Parquet files are immutable)
- `trustedKeyGroups` requires CloudFront signed URLs for access
- `coopCoepHeaders` applies COOP/COEP to Parquet responses too (same-origin, so `require-corp` is fine)

**Step 6: Bump ECS memory to 4GB**

In the task definition (line ~145), change:
```typescript
      memoryLimitMiB: 2048,
```
to:
```typescript
      memoryLimitMiB: 4096,
```

**Step 7: Output the key pair ID and distribution domain**

After existing outputs, add:

```typescript
    new cdk.CfnOutput(this, 'CfKeyPairId', {
      value: cfPublicKey.publicKeyId,
      description: 'CloudFront key pair ID for signing Parquet URLs',
    });
```

**Step 8: Pass CloudFront config to ECS container as environment variables**

Find the container environment section in the task definition and add:

```typescript
      CF_DOMAIN: distribution.distributionDomainName,
      CF_KEY_PAIR_ID: cfPublicKey.publicKeyId,
```

Also grant the task role read access to the SSM parameter:

```typescript
    const cfPrivateKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'CfPrivateKey', {
      parameterName: '/genome-hub/cloudfront-private-key',
    });
    cfPrivateKeyParam.grantRead(taskRole);
```

**Step 9: Verify CDK synth**

Run: `cd packages/infra && npx cdk synth --quiet`

Expected: Synthesizes without errors.

**Step 10: Commit**

```bash
git add packages/infra/stack.ts
git commit -m "feat: add CloudFront OAC + signed URLs for Parquet, bump ECS to 4GB"
```

---

### Task 5: Server — CloudFront Signed URL Endpoint

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/routes/files.ts`

**Step 1: Add cloudfront-signer dependency**

In `packages/server/package.json`, add to `dependencies`:
```json
"@aws-sdk/cloudfront-signer": "^3.600.0"
```

Run: `npm install -w packages/server`

**Step 2: Create signing helper**

In `packages/server/src/routes/files.ts`, add imports at the top:

```typescript
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
```

Add a lazy-loaded private key cache near the top of the file:

```typescript
let _cfPrivateKey: string | null = null;
const CF_DOMAIN     = process.env.CF_DOMAIN;
const CF_KEY_PAIR_ID = process.env.CF_KEY_PAIR_ID;

async function getCfPrivateKey(): Promise<string> {
  if (_cfPrivateKey) return _cfPrivateKey;
  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-west-2' });
  const res = await ssm.send(new GetParameterCommand({
    Name: '/genome-hub/cloudfront-private-key',
    WithDecryption: true,
  }));
  _cfPrivateKey = res.Parameter!.Value!;
  return _cfPrivateKey;
}
```

**Step 3: Rewrite the parquet-url endpoint**

Replace the existing `GET /:id/parquet-url` handler (lines ~124-155) with:

```typescript
router.get('/:id/parquet-url', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  if (!file.filename.toLowerCase().endsWith('.json')) {
    res.json({ status: 'unavailable', reason: 'not a JSON file' });
    return;
  }
  if (Number(file.sizeBytes) > 1.5 * 1024 * 1024 * 1024) {
    res.json({ status: 'unavailable', reason: 'file too large' });
    return;
  }

  // Use parquetStatus if set, otherwise infer from parquetS3Key
  const status = file.parquetStatus ?? (file.parquetS3Key ? 'ready' : 'converting');

  if (status === 'failed') {
    res.json({ status: 'failed' });
    return;
  }
  if (status !== 'ready' || !file.parquetS3Key) {
    res.json({ status: 'converting' });
    return;
  }

  // CloudFront signed URL (production) or S3 presigned URL (local dev fallback)
  if (CF_DOMAIN && CF_KEY_PAIR_ID) {
    const privateKey = await getCfPrivateKey();
    const url = getCloudFrontSignedUrl({
      url: `https://${CF_DOMAIN}/parquet/${file.parquetS3Key}`,
      keyPairId: CF_KEY_PAIR_ID,
      privateKey,
      dateLessThan: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    res.json({ status: 'ready', url });
  } else {
    // Local dev fallback: S3 presigned URL
    const url = await presignDownloadUrl(file.parquetS3Key, 'preview.parquet');
    res.json({ status: 'ready', url });
  }
}));
```

**Step 4: Add `@aws-sdk/client-ssm` dependency**

In `packages/server/package.json`, add:
```json
"@aws-sdk/client-ssm": "^3.600.0"
```

Run: `npm install -w packages/server`

**Step 5: Verify server builds**

Run: `npm run build -w packages/server`

Expected: Compiles without errors.

**Step 6: Commit**

```bash
git add packages/server/package.json packages/server/src/routes/files.ts package-lock.json
git commit -m "feat: serve Parquet via CloudFront signed URLs with local dev fallback"
```

---

### Task 6: Client Hook — isQuerying + Failed Status

**Files:**
- Modify: `packages/client/src/hooks/useParquetPreview.ts`

**Step 1: Add 'failed' to ParquetStatus type**

Find the `ParquetStatus` type (line ~32) and add `'failed'`:

```typescript
type ParquetStatus = 'polling' | 'initializing' | 'loading' | 'ready' | 'unavailable' | 'failed' | 'error';
```

**Step 2: Add isQuerying state**

In the hook body, add state:

```typescript
const [isQuerying, setIsQuerying] = useState(false);
```

**Step 3: Handle 'failed' in polling**

In the `poll()` function (line ~92), find the status check and add a `'failed'` case:

```typescript
if (data.status === 'ready') {
  await initDuckDb(data.url);
} else if (data.status === 'converting') {
  setStatus('polling');
  pollTimer = setTimeout(poll, 2000);
} else if (data.status === 'failed') {
  setStatus('failed');
} else {
  setStatus('unavailable');
}
```

**Step 4: Wrap applyFilters with isQuerying**

In the `applyFilters` callback (line ~316), set `isQuerying` before the query and clear it after:

Find the start of the function body and add `setIsQuerying(true)` as the first line. Find the return statement and add `setIsQuerying(false)` before it. Also add it in the catch block.

The pattern:

```typescript
const applyFilters = useCallback(async (filters: FilterSpec[], sort: SortSpec | null) => {
  setIsQuerying(true);
  try {
    // ... existing query logic (buildWhere, buildOrderBy, COUNT, MIN/MAX) ...
    setIsQuerying(false);
    return { filteredCount, constrainedStats };
  } catch (err) {
    setIsQuerying(false);
    throw err;
  }
}, [/* existing deps */]);
```

**Step 5: Return isQuerying and update the return type**

In the hook's return object, add `isQuerying`:

```typescript
return {
  status, columns, totalRows, filteredCount,
  columnStats, columnCardinality, error,
  fetchWindow, applyFilters, isQuerying,
};
```

**Step 6: Verify client builds**

Run: `npm run build -w packages/client`

Expected: Compiles without errors.

**Step 7: Commit**

```bash
git add packages/client/src/hooks/useParquetPreview.ts
git commit -m "feat: add isQuerying state and failed status to useParquetPreview"
```

---

### Task 7: Client Component — Skeleton Shimmer + Step Labels

**Files:**
- Modify: `packages/client/src/components/ParquetPreview.tsx`
- Modify: `packages/client/src/components/FilePreview.tsx`

**Step 1: Fix loading step labels**

In `ParquetPreview.tsx`, find the steps array (line ~764):

```typescript
    const steps = [
      { label: 'Converting',   active: status === 'polling' },
      { label: 'Connecting',   active: status === 'initializing' },
      { label: 'Reading',      active: status === 'loading' },
      { label: 'Ready',        active: false },
    ];
```

Change to:
```typescript
    const steps = [
      { label: 'Preparing',    active: status === 'polling' },
      { label: 'Connecting',   active: status === 'initializing' },
      { label: 'Reading',      active: status === 'loading' },
      { label: 'Ready',        active: false },
    ];
```

**Step 2: Destructure isQuerying from the hook**

In the `ParquetPreview` component (line ~565), add `isQuerying` to the destructured return:

```typescript
  const {
    status, columns, totalRows, filteredCount,
    columnStats, columnCardinality, error,
    fetchWindow, applyFilters, isQuerying,
  } = useParquetPreview(fileId);
```

**Step 3: Add skeleton shimmer overlay to the data grid**

In the scrollable body section (the `<div ref={scrollRef}` around line ~888), wrap the `VirtualRows` component with a shimmer overlay when `isQuerying` is true:

```tsx
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto"
            style={{ position: 'relative' }}
            onScroll={() => {
              if (headerRef.current && scrollRef.current)
                headerRef.current.scrollLeft = scrollRef.current.scrollLeft;
            }}
          >
            {/* Skeleton shimmer overlay during network-bound queries */}
            {isQuerying && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                background: 'var(--color-void)',
                opacity: 0.7,
                pointerEvents: 'none',
              }}>
                <div className="flex flex-col gap-0 p-0">
                  {Array.from({ length: Math.ceil(PANEL_H / ROW_H) }, (_, i) => (
                    <div key={i} className="flex" style={{ height: ROW_H }}>
                      {tableColumns.map(c => (
                        <div key={c.name} style={{
                          width: colWidths[c.name] ?? colWFromName(c.name, c.type),
                          minWidth: 50, flexShrink: 0, padding: '0 6px',
                          borderBottom: '1px solid var(--color-line)',
                          lineHeight: `${ROW_H}px`,
                        }}>
                          <div className="skeleton rounded"
                            style={{ height: 12, width: `${40 + (i * 17 + c.name.length * 7) % 40}%`, marginTop: 8 }} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredCount > 0 && (
              <VirtualRows ... />
            )}

            {/* existing empty-state block */}
          </div>
```

The shimmer:
- Covers the entire scroll area with an absolute overlay
- Uses `var(--color-void)` background at 70% opacity so table structure bleeds through
- Renders skeleton rows matching the column layout
- `pointerEvents: 'none'` allows scroll to still work underneath
- Each skeleton bar has a varied width based on column name + row index to avoid a uniform grid look

**Step 4: Handle 'failed' status in FilePreview.tsx**

In `packages/client/src/components/FilePreview.tsx`, in the `JsonPreview` component, update the status check to treat `'failed'` as a Strand fallback:

Find the check around line ~33:
```typescript
        if (data.status === 'ready') {
          setMode('parquet');
        } else if (data.status === 'converting') {
          setMode('parquet');
        } else {
          setMode('strand');
        }
```

Change to:
```typescript
        if (data.status === 'ready' || data.status === 'converting') {
          setMode('parquet');
        } else {
          // 'failed', 'unavailable', or any unexpected status → Strand fallback
          setMode('strand');
        }
```

**Step 5: Verify client builds**

Run: `npm run build -w packages/client`

Expected: Compiles without errors.

**Step 6: Commit**

```bash
git add packages/client/src/components/ParquetPreview.tsx packages/client/src/components/FilePreview.tsx
git commit -m "feat: add skeleton shimmer during queries, fix step labels, handle failed status"
```

---

### Task 8: End-to-End Verification

**Step 1: Verify all builds pass**

```bash
npm run build -w packages/server && npm run build -w packages/client
```

Expected: Both compile without errors.

**Step 2: Verify CDK synth**

```bash
cd packages/infra && npx cdk synth --quiet
```

Expected: Synthesizes without errors. Check the template contains:
- S3 origin with OAC
- `/parquet/*` behavior with `TrustedKeyGroups`
- ECS task with 4096 MiB memory

**Step 3: Verify Docker build**

```bash
docker build -t genomehub:test .
```

Expected: Build succeeds on Debian slim. DuckDB installs without native compilation.

**Step 4: Deploy and test**

After CDK deploy, verify:

1. **Note the CloudFront key pair ID** from stack outputs (`CfKeyPairId`)
2. **Upload a small JSON file** (< 10MB for quick test)
3. **Check server logs** for `Parquet conversion complete: s3://...`
4. **Check DB** for `parquet_status = 'ready'` and populated `parquet_s3_key`
5. **Click file in UI** → should show Parquet preview with "Preparing → Connecting → Reading → Ready" flow
6. **Apply a filter** → skeleton shimmer should appear briefly, then resolve
7. **Upload a non-JSON file** → should not trigger conversion
8. **Verify signed URLs** → `curl` the returned URL without CloudFront signature → should get 403
9. **Verify range requests** → DuckDB WASM should fetch only row groups, not the full file (check Network tab, look for `206 Partial Content` responses)

**Step 5: Test 610MB file**

Upload `saccer3_dcas9_guides.json`:
1. Conversion should complete within ~2 minutes (S3-to-S3, no download to server)
2. Preview should load instantly (Parquet footer only)
3. Scroll to row 850K without downloading 610MB
4. Filter/sort → skeleton shimmer → resolves with filtered data

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: parquet deployment hardening — S3-to-S3 conversion, CloudFront signed URLs, skeleton shimmer"
```

---

## File Reference

| File | Action | Purpose |
|------|--------|---------|
| `Dockerfile` | Modify | Alpine → Debian slim |
| `packages/server/src/migrations/014_parquet_status.sql` | Create | Add `parquet_status` column |
| `packages/server/src/entities/index.ts` | Modify | Add `parquetStatus` column to entity |
| `packages/server/src/lib/parquet.ts` | Rewrite | DuckDB S3-to-S3 + retry with backoff |
| `packages/server/src/routes/uploads.ts` | Modify | Set `parquetStatus`, pass `BUCKET` |
| `packages/server/src/routes/files.ts` | Modify | CloudFront signed URLs, parquetStatus |
| `packages/server/package.json` | Modify | Add `@aws-sdk/cloudfront-signer`, `@aws-sdk/client-ssm` |
| `packages/infra/stack.ts` | Modify | OAC, `/parquet/*` behavior, key group, 4GB |
| `packages/client/src/hooks/useParquetPreview.ts` | Modify | `isQuerying`, `'failed'` status |
| `packages/client/src/components/ParquetPreview.tsx` | Modify | Skeleton shimmer, step labels |
| `packages/client/src/components/FilePreview.tsx` | Modify | Handle `'failed'` → Strand fallback |

## Prerequisite: One-Time Key Pair Setup

Before deploying Task 4, run:
```bash
openssl genrsa -out /tmp/cf-private-key.pem 2048
openssl rsa -in /tmp/cf-private-key.pem -pubout -out /tmp/cf-public-key.pem
aws ssm put-parameter --name /genome-hub/cloudfront-private-key --type SecureString --value "$(cat /tmp/cf-private-key.pem)" --region us-west-2
```

Then paste the public key PEM content into `stack.ts` at the `encodedKey` field.

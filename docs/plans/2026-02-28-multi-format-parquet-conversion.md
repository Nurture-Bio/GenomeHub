# Multi-Format Parquet Conversion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert all rectangular file formats (CSV, TSV, BED, VCF, GFF, GTF) to Parquet sidecars at upload time, enabling the full DuckDB WASM preview (filter, sort, virtualise) for all tabular data.

**Architecture:** Add `isConvertible()` to the shared formats package as the single source of truth. Generalise the server's `convertJsonToParquet` to accept a format parameter and select the appropriate DuckDB reader function. Widen the `.json`-only guards in uploads and the parquet-url endpoint. On the client, rename `JsonPreview` to `DatasetPreview` and route all convertible formats through it.

**Tech Stack:** DuckDB (server-side Node.js native, client-side WASM), TypeScript, Express, React, `@genome-hub/shared`

---

### Task 1: Add `isConvertible` to shared formats package

**Files:**
- Modify: `packages/shared/src/formats.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Add the convertible format set and predicate to `formats.ts`**

```typescript
// Append to packages/shared/src/formats.ts

/**
 * Formats that can be converted to Parquet sidecars by the server.
 * DuckDB reads these via read_json_auto or read_csv_auto.
 */
const CONVERTIBLE_FORMATS = new Set([
  'json', 'csv', 'tsv', 'bed', 'vcf', 'gff', 'gtf',
]);

/**
 * True when the file's format can be server-converted to a Parquet sidecar
 * for DuckDB WASM preview.
 */
export function isConvertible(filename: string): boolean {
  return CONVERTIBLE_FORMATS.has(detectFormat(filename));
}
```

**Step 2: Re-export from index.ts**

```typescript
export { detectFormat, isConvertible } from './formats.js';
```

**Step 3: Rebuild the shared package and verify**

Run: `npm run build -w packages/shared`
Expected: exit 0, `dist/` updated

**Step 4: Commit**

```bash
git add packages/shared/src/formats.ts packages/shared/src/index.ts
git commit -m "feat(shared): add isConvertible predicate for multi-format Parquet conversion"
```

---

### Task 2: Generalise server conversion function

**Files:**
- Modify: `packages/server/src/lib/parquet.ts`

**Step 1: Rename function and add format-aware DuckDB reader selection**

The function signature changes from:
```typescript
export async function convertJsonToParquet(
  bucket: string, s3Key: string, parquetS3Key: string,
  sizeBytes?: number, fileId?: string,
): Promise<void>
```

To:
```typescript
export async function convertToParquet(
  bucket: string, s3Key: string, parquetS3Key: string,
  format: string, sizeBytes?: number, fileId?: string,
): Promise<void>
```

In `runDuckDbS3Conversion`, replace the hardcoded `read_json_auto` SQL with a format-dispatch function:

```typescript
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
    default:
      return `read_csv_auto('${safeSrc}')`;
  }
}
```

The SQL in `runDuckDbS3Conversion` becomes:

```typescript
const reader = duckDbReader(src, ctx.format);
const sql = `
  INSTALL httpfs; LOAD httpfs;
  INSTALL aws; LOAD aws;
  CALL load_aws_credentials();
  COPY (
    SELECT * FROM ${reader}
  ) TO '${safeDst}' (FORMAT PARQUET, ROW_GROUP_SIZE 122880, COMPRESSION 'ZSTD');
`;
```

Add `format: string` to the `ConversionContext` interface and thread it through.

Also rename `MAX_JSON_BYTES` → `MAX_CONVERSION_BYTES` and update the JSDoc from "JSON → Parquet" to "File → Parquet".

**Step 2: Rebuild the server and verify**

Run: `npm run build -w packages/server`
Expected: exit 0, no type errors

**Step 3: Commit**

```bash
git add packages/server/src/lib/parquet.ts
git commit -m "feat(server): generalise Parquet conversion to support CSV/TSV/BED/VCF/GFF/GTF"
```

---

### Task 3: Update upload completion to trigger conversion for all convertible formats

**Files:**
- Modify: `packages/server/src/routes/uploads.ts:105-122`

**Step 1: Replace the `.json`-only guard**

Change `uploads.ts` line 105:
```typescript
// Before:
if (file && file.filename.toLowerCase().endsWith('.json')) {
```
```typescript
// After:
if (file && isConvertible(file.filename)) {
```

Change line 109 to pass format:
```typescript
// Before:
convertJsonToParquet(BUCKET, file.s3Key, parquetKey, Number(actualSize), fileId)
```
```typescript
// After:
convertToParquet(BUCKET, file.s3Key, parquetKey, detectFormat(file.filename), Number(actualSize), fileId)
```

Update the import at the top of the file (line 12):
```typescript
// Before:
import { convertJsonToParquet } from '../lib/parquet.js';
```
```typescript
// After:
import { convertToParquet } from '../lib/parquet.js';
```

Add `isConvertible` to the existing `@genome-hub/shared` import (line 10):
```typescript
import { detectFormat, isConvertible } from '@genome-hub/shared';
```

**Step 2: Rebuild and verify**

Run: `npm run build -w packages/server`
Expected: exit 0

**Step 3: Commit**

```bash
git add packages/server/src/routes/uploads.ts
git commit -m "feat(server): trigger Parquet conversion for all convertible formats at upload"
```

---

### Task 4: Update parquet-url endpoint to serve all convertible formats

**Files:**
- Modify: `packages/server/src/routes/files.ts:10,171-174,198-201`

**Step 1: Replace the `.json`-only guard on the parquet-url endpoint**

Change line 171:
```typescript
// Before:
if (!file.filename.toLowerCase().endsWith('.json')) {
  res.json({ status: 'unavailable', reason: 'not a JSON file' });
```
```typescript
// After:
if (!isConvertible(file.filename)) {
  res.json({ status: 'unavailable', reason: 'format not supported for dataset preview' });
```

Change line 200 (the legacy on-demand conversion path) to pass format:
```typescript
// Before:
convertJsonToParquet(BUCKET, file.s3Key, parquetKey, Number(file.sizeBytes), file.id)
```
```typescript
// After:
convertToParquet(BUCKET, file.s3Key, parquetKey, detectFormat(file.filename), Number(file.sizeBytes), file.id)
```

Update the import at line 10:
```typescript
// Before:
import { convertJsonToParquet } from '../lib/parquet.js';
```
```typescript
// After:
import { convertToParquet } from '../lib/parquet.js';
```

Add `isConvertible` to the existing `@genome-hub/shared` import (line 6):
```typescript
import { detectFormat, isConvertible } from '@genome-hub/shared';
```

**Step 2: Rebuild and verify**

Run: `npm run build -w packages/server`
Expected: exit 0

**Step 3: Commit**

```bash
git add packages/server/src/routes/files.ts
git commit -m "feat(server): serve Parquet URLs for all convertible formats"
```

---

### Task 5: Update client FilePreview routing for all convertible formats

**Files:**
- Modify: `packages/client/src/components/FilePreview.tsx`

**Step 1: Replace the `.json`-only routing with `isConvertible`**

Add import at the top:
```typescript
import { detectFormat, isConvertible } from '@genome-hub/shared';
```

Rename `JsonPreview` → `DatasetPreview`. Update the comment on line 72:
```typescript
// ── Dataset preview: Parquet path with head-preview fallback ─────────────
```

In the `DatasetPreview` component, add a `filename` prop and use it for the fallback:

```typescript
function DatasetPreview({ fileId, sizeBytes, filename }: {
  fileId: string; sizeBytes: number; filename: string;
}) {
```

In the fallback path (currently line 141-144), route based on format:

```typescript
  // Head preview fallback — format-specific
  if (error) return <Text variant="dim" style={{ color: 'var(--color-red)' }}>{error}</Text>;
  if (!url)  return <div className="skeleton h-1 rounded-full w-1/2" />;
  if (detectFormat(filename) === 'json') {
    return <JsonHeadPreview url={url} />;
  }
  // Non-JSON convertible formats: TextPreview fallback handled by parent
  return null;
```

In the main `FilePreview` component (line 207-235), replace:

```typescript
// Before:
const isJson = filename.toLowerCase().endsWith('.json');
// ...
} = useInfiniteFilePreview(!isJson ? fileId : undefined);

if (isJson) {
  return <JsonPreview fileId={fileId} sizeBytes={sizeBytes} />;
}
```

```typescript
// After:
const convertible = isConvertible(filename);
// ...
} = useInfiniteFilePreview(!convertible ? fileId : undefined);

if (convertible) {
  return <DatasetPreview fileId={fileId} sizeBytes={sizeBytes} filename={filename} />;
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: exit 0, no errors

**Step 3: Verify no stale references**

Run: `grep -rn 'isJson\|JsonPreview' packages/client/src/components/FilePreview.tsx`
Expected: no matches

**Step 4: Commit**

```bash
git add packages/client/src/components/FilePreview.tsx
git commit -m "feat(client): route all convertible formats through DatasetPreview with Parquet"
```

---

### Task 6: Full build verification

**Step 1: Rebuild all packages**

Run: `npm run build -w packages/shared && npm run build -w packages/server && npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: all three succeed with exit 0

**Step 2: Verify no dangling references to old function name**

Run: `grep -rn 'convertJsonToParquet' packages/server/src/`
Expected: no matches

Run: `grep -rn "endsWith('.json')" packages/server/src/routes/uploads.ts packages/server/src/routes/files.ts`
Expected: no matches

Run: `grep -rn 'isJson' packages/client/src/components/FilePreview.tsx`
Expected: no matches

**Step 3: Commit (if any fixups needed)**

---

## Summary of All Changes

| File | Change |
|------|--------|
| `packages/shared/src/formats.ts` | Add `CONVERTIBLE_FORMATS` set and `isConvertible()` predicate |
| `packages/shared/src/index.ts` | Re-export `isConvertible` |
| `packages/server/src/lib/parquet.ts` | Rename to `convertToParquet`, add `format` param, add `duckDbReader()` dispatch |
| `packages/server/src/routes/uploads.ts` | Use `isConvertible()` instead of `.endsWith('.json')`, pass format to converter |
| `packages/server/src/routes/files.ts` | Use `isConvertible()` instead of `.endsWith('.json')`, pass format to converter |
| `packages/client/src/components/FilePreview.tsx` | Rename `JsonPreview` → `DatasetPreview`, route all convertible formats through Parquet path |

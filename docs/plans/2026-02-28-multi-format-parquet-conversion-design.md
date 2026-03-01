# Multi-Format Parquet Conversion

Convert all rectangular file formats (CSV, TSV, BED, VCF, GFF/GTF) to Parquet sidecars at upload time, reusing the existing JSON conversion pipeline. The client routes all convertible formats through `ParquetPreview` (DuckDB WASM + HTTP range requests) for filtering, sorting, and virtualised display.

## Context

Today only `.json` files trigger Parquet conversion. CSV, TSV, BED, VCF, and GFF files get a plain text preview (50 lines/page, no filtering, no sorting). The DuckDB infrastructure on both server and client is already format-agnostic — the only barriers are three hardcoded `.endsWith('.json')` guards.

## Architecture

```
Upload completes
  │
  ├── isConvertible(format)?
  │     yes → convertToParquet(bucket, s3Key, parquetKey, format, size, fileId)
  │            DuckDB :memory: → read_json_auto / read_csv_auto / ... → COPY TO Parquet
  │            parquetStatus: 'converting' → 'ready' | 'failed'
  │     no  → no conversion (binary files, unknown formats)
  │
Client loads FilePreview
  │
  ├── isConvertible(format)?
  │     yes → GET /api/files/:id/parquet-url
  │           ├── 'ready'      → ParquetPreview (DuckDB WASM, full filter/sort/virtualise)
  │           ├── 'converting' → poll (2s interval)
  │           ├── 'failed' && large → DatasetErrorState
  │           └── 'failed' && small → format-specific head preview fallback
  │     no  → TextPreview (plain text, infinite scroll)
```

## Changes

### 1. Shared: Convertible format set

Add to `packages/shared/src/formats.ts`:

```typescript
const CONVERTIBLE_FORMATS = new Set([
  'json', 'csv', 'tsv', 'bed', 'vcf', 'gff', 'gtf',
]);

export function isConvertible(filename: string): boolean {
  return CONVERTIBLE_FORMATS.has(detectFormat(filename));
}
```

Single source of truth — server and client both import this.

### 2. Server: `lib/parquet.ts` — Generalise conversion function

Rename `convertJsonToParquet` → `convertToParquet`. Accept a `format` parameter. Select the DuckDB reader based on format:

| Format | DuckDB reader expression |
|--------|--------------------------|
| `json` | `read_json_auto(src, maximum_object_size=104857600)` |
| `csv`  | `read_csv_auto(src)` |
| `tsv`  | `read_csv_auto(src, delim='\t')` |
| `bed`  | `read_csv_auto(src, delim='\t', header=false)` |
| `vcf`  | `read_csv_auto(src, delim='\t', comment='#')` |
| `gff`, `gtf` | `read_csv_auto(src, delim='\t', comment='#', header=false)` |

The `COPY ... TO ... (FORMAT PARQUET, ROW_GROUP_SIZE 122880, COMPRESSION 'ZSTD')` output is identical for all formats.

The size cap (`MAX_CONVERSION_BYTES = 1.5 GB`) applies uniformly.

### 3. Server: `routes/uploads.ts` — Trigger conversion for all convertible formats

Replace:
```typescript
if (file && file.filename.toLowerCase().endsWith('.json')) {
```
With:
```typescript
if (file && isConvertible(file.filename)) {
```

Pass `detectFormat(file.filename)` to `convertToParquet` so it picks the right reader.

### 4. Server: `routes/files.ts` — Remove `.json`-only guard on parquet-url

Replace:
```typescript
if (!file.filename.toLowerCase().endsWith('.json')) {
  res.json({ status: 'unavailable', reason: 'not a JSON file' });
  return;
}
```
With:
```typescript
if (!isConvertible(file.filename)) {
  res.json({ status: 'unavailable', reason: 'format not supported for dataset preview' });
  return;
}
```

The legacy-file on-demand conversion path (lines 190-216) also needs the format parameter passed through.

### 5. Client: `FilePreview.tsx` — Route convertible formats to dataset preview

Replace:
```typescript
const isJson = filename.toLowerCase().endsWith('.json');
```
With:
```typescript
const convertible = isConvertible(filename);
```

The `JsonPreview` component becomes `DatasetPreview` (renamed for clarity). Its fallback path routes based on format:
- JSON files that fail Parquet and are small → `JsonHeadPreview`
- All other convertible files that fail Parquet and are small → `TextPreview`

Large failed files continue to show `DatasetErrorState`.

## What Does Not Change

- `ParquetPreview.tsx` — already format-agnostic (reads Parquet, not the source format)
- `useParquetPreview.ts` — all DuckDB query machinery reused as-is
- `duckdb.ts` — singleton engine, unchanged
- S3 naming: `{originalKey}.parquet`
- Database schema: `parquet_status`, `parquet_s3_key`, `parquet_error` columns reused
- Polling UX: 2-second interval, same status state machine
- `JsonHeadPreview` / `useDatasetHead` / `scanners.ts` — unchanged, JSON fallback only

## Fallback Strategy

| Condition | Behaviour |
|-----------|-----------|
| Parquet ready | `ParquetPreview` (full DuckDB WASM) |
| Parquet converting | Polling skeleton |
| Parquet failed, large file | `DatasetErrorState` (error card) |
| Parquet failed, small JSON | `JsonHeadPreview` (first 1,000 rows) |
| Parquet failed, small CSV/TSV/etc. | `TextPreview` (plain text fallback) |
| Non-convertible format | `TextPreview` (plain text, infinite scroll) |
| Binary file | Nothing rendered (binary sniff) |

## Error Handling

DuckDB's `read_csv_auto` can fail on malformed files (encoding issues, inconsistent column counts, binary data misidentified by extension). This is already handled:
- `convertToParquet` retries 3x with exponential backoff
- On final failure, `parquetStatus = 'failed'` with the error message stored
- Client shows `DatasetErrorState` for large files, `TextPreview` fallback for small files
- No new error modes are introduced

## Migration

Existing files uploaded before this change have `parquetStatus = NULL` for non-JSON formats. The `parquet-url` endpoint's legacy path (lines 190-216) handles this: on first view, it atomically claims the conversion and fires DuckDB. This is the same race-safe pattern already used for pre-Parquet JSON files.

# Data Profiler — Architecture Decision Record

## Status

**Accepted.** Implemented across `packages/server/src/lib/data_profile.ts`,
`packages/server/src/routes/files.ts`, `packages/server/src/routes/uploads.ts`,
and `packages/client/src/hooks/useDataProfile.ts`.

## Context

GenomeHub converts uploaded files to Parquet and computes metadata about the
dataset — column statistics, cardinality distributions, character lengths — so
the UI can render stable column widths, heatmaps, and filter dropdowns without
client-side computation.

The problem: not all metadata is needed by every view, computation takes 1-2s
per attribute for large files, and new attributes get added over time. A
traditional approach (compute everything at upload, run a migration for new
attributes) creates unnecessary work and fragile coupling.

## Decision

**Lazy hydration with eager pre-compute and async fallback.**

Three layers, each progressively less common:

1. **Eager compute (primary path):** After Parquet conversion completes at
   upload time, the server immediately hydrates ALL enrichable attributes.
   By the time a user visits the file, the full profile is already in JSONB.

2. **202 + polling (fallback path):** If a user visits a file before eager
   compute finishes (or for files uploaded before a new attribute was added),
   the `/data-profile` endpoint returns `202 { status: 'computing' }` and
   kicks off hydration as fire-and-forget. The client polls every 1s until
   it gets a `200`.

3. **Negative caching:** If computation fails for an attribute, the value is
   set to `null` in JSONB. The client renders "not available" and never
   retries. This prevents infinite polling loops on bad data.

## Three-State Semantics

Every enrichable attribute in the `DataProfile` JSONB follows these rules:

| Value       | Meaning                | Action              |
|-------------|------------------------|---------------------|
| `undefined` | Never attempted        | Trigger computation |
| `null`      | Attempted, failed      | Do not retry        |
| `{...}`     | Computed successfully  | Serve from cache    |

This is enforced by the TypeScript type system via `Lazy<T> = T | null` and
optional properties on `DataProfile`.

## Data Flow

```
Upload completes
    │
    ▼
convertToParquet()          ← fire-and-forget from /complete
    │
    ▼
extractBaseProfile()        ← Parquet footer only (schema + rowCount), ~100ms
    │
    ▼
hydrateAttributes(ALL_KEYS) ← full DuckDB scan, ~1-3s total
    │
    ▼
mergeProfileToDb()          ← JSONB deep merge into genomic_files.data_profile
    │
    ▼
User visits /files/:id      ← profile already in JSONB, zero compute
```

**Fallback (old files or race condition):**

```
User visits /files/:id
    │
    ▼
GET /data-profile?attributes=columnStats,cardinality,charLengths
    │
    ├── All keys present → 200 { profile }          (fast path)
    │
    └── Some keys missing → 202 { status: 'computing', profile: partial }
         │                    (fire-and-forget hydration started)
         ▼
    Client polls every 1s
         │
         ▼
    GET /data-profile?attributes=...
         │
         └── All keys present → 200 { profile }     (done)
```

## Request Coalescing

A module-level `inflight` Map (keyed by `fileId`) prevents duplicate DuckDB
sessions. If two requests arrive for the same file:

1. Request A becomes the "leader" — creates a DuckDB session, computes.
2. Request B sees `inflight.has(fileId)` → awaits A's promise.
3. When A finishes, both get the result. Only one DuckDB scan occurred.

The client has a parallel deduplication layer: a `fetchCache` Map (keyed by
`fileId:sortedAttributes`) prevents duplicate HTTP requests from React Strict
Mode double-fires.

## JSONB Deep Merge

Persistence uses PostgreSQL's JSONB merge operator:

```sql
UPDATE genomic_files
SET data_profile = COALESCE(data_profile, '{}'::jsonb) || $1::jsonb
WHERE id = $2
```

Only the newly computed keys are patched. Existing keys are preserved. This
means multiple concurrent hydrations for different attributes on the same file
won't clobber each other.

## Adding a New Attribute

1. Add the data shape interface to `packages/shared/src/data_profile.ts`.
2. Add one line to `EnrichableAttributes`.
3. Write an `enrichFoo()` function in `packages/server/src/lib/data_profile.ts`.
4. Add a case to `hydrateAttribute()`.
5. Add the key to `VALID_KEYS`.

That's it. No migration needed. The next time any user visits a file:
- If uploaded after this change: eager compute already ran with the new key.
- If uploaded before: the 202 fallback fires, computes the new attribute,
  persists it, and all subsequent visits are instant.

## Client Integration

`useDataProfile(fileId, attributes[], baseProfile)` handles everything:

- Seeds from Zustand cache (instant on repeat visits).
- Falls back to `baseProfile` from `parquet-url` response.
- Computes which requested keys are `=== undefined`.
- Fetches missing keys from `/data-profile`.
- On `202`: polls every 1s until `200` (max 30 attempts).
- Merges result into local state AND Zustand store.
- Components check `profile.columnStats === null` to render "not available"
  vs a skeleton placeholder.

## Zustand Cache

`useAppStore.fileProfiles[fileId]` stores:

```typescript
{
  dataProfile: DataProfile,   // merged profile
  parquetUrl: string,         // presigned URL (TTL 50min)
  cachedAt: number,           // Date.now()
}
```

`mergeFileProfile(fileId, patch)` deep-merges new attributes without
overwriting existing ones. The cache is volatile (not persisted to
localStorage) — fresh on each session.

## STRUCT Expansion

Columns with DuckDB type `STRUCT(foo VARCHAR, bar BIGINT)` are transparently
flattened into dot-notation keys: `col.foo`, `col.bar`. SQL expressions use
proper quoting: `"col"."foo"`. This ensures nested Parquet columns appear as
individual entries in stats, cardinality, and charLengths.

## Why Not...

**...compute everything at upload time only (no fallback)?**
Because new attributes get added. Files uploaded before the attribute existed
would never get it. The fallback path is the backfill mechanism.

**...use SSE for real-time streaming?**
EventSource doesn't support custom `Authorization` headers. Would need cookie
fallback or query-param tokens — adds auth complexity for marginal UX gain
over 1s polling.

**...use a job queue (Bull, pg-boss)?**
Overkill. DuckDB computes finish in 1-3s. The in-process fire-and-forget
pattern with the inflight coalescing Map handles all concurrency concerns.
A queue would add infrastructure (Redis) and operational complexity for no
practical benefit at this scale.

**...cache in Redis instead of JSONB?**
The profile is tightly coupled to the file entity and never expires (the
Parquet file is immutable). JSONB in the same row eliminates a cache
invalidation problem that doesn't need to exist.

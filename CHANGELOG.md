# Changelog

## 2026-02-28 — Demand-Driven Lazy Hydration for DataProfile

### What Changed

The `data_profile` JSONB column on `genomic_files` is now populated lazily and
incrementally. The client tells the server exactly which metadata attributes it
needs; the server computes only the missing ones, persists the result via
PostgreSQL `||` JSONB merge, and returns. No attribute is ever computed that the
UI did not ask for.

#### New endpoint

```
GET /api/files/:id/data-profile?attributes=columnStats,cardinality,charLengths
```

The server validates keys against `keyof EnrichableAttributes`, filters to those
that are `=== undefined` in the stored JSONB (skipping `null` — see negative
caching below), opens one DuckDB session, computes the missing set, and persists.

#### Upload path change

At upload time, only the **base profile** is extracted (schema + rowCount from
the Parquet footer — free, no data scan). Everything else is computed on demand
when the client first requests it.

#### Client changes

- **`useDataProfile(fileId, attributes[], baseProfile)`** — new hook that
  fetches missing attributes from the server. Module-level `fetchCache` Map
  (keyed by `fileId:sortedAttributes`) deduplicates concurrent calls, including
  React Strict Mode double-fires. Auto-cleans via `.finally()`.
- **`useParquetPreview`** — no longer computes stats or cardinality client-side.
  Accepts base profile from `parquet-url` response, uses server schema/rowCount
  when available (skips DuckDB WASM metadata queries). Returns `baseProfile` for
  downstream consumption.
- **`ParquetPreview`** — calls `useDataProfile` for `columnStats`, `cardinality`,
  and `charLengths`. Derives the component's local `ColumnStats` /
  `ColumnCardinality` types from the server profile. Handles `null` (negative
  cache) gracefully.

### Files Modified

| File | Change |
|------|--------|
| `packages/shared/src/data_profile.ts` | New: `EnrichableAttributes`, `Lazy<T>`, mapped `DataProfile` type |
| `packages/shared/src/index.ts` | Exports `EnrichableAttributes`, `Lazy` |
| `packages/server/src/entities/index.ts` | `dataProfile` JSONB column mapped on `GenomicFile` entity |
| `packages/server/src/lib/data_profile.ts` | New: `hydrateAttributes()`, dispatch switch, file-level coalescing, `mergeProfileToDb()` |
| `packages/server/src/routes/files.ts` | New `GET /:id/data-profile` endpoint; `parquet-url` returns base profile |
| `packages/server/src/routes/uploads.ts` | Upload complete extracts base profile only (no eager enrichment) |
| `packages/client/src/hooks/useDataProfile.ts` | New: demand-driven fetch with Promise cache dedup |
| `packages/client/src/hooks/useParquetPreview.ts` | Removed client-side stats/cardinality computation; returns `baseProfile` |
| `packages/client/src/components/ParquetPreview.tsx` | Wired `useDataProfile`; derives stats/cardinality from server profile |

---

### Architectural Philosophy

This section is written for future engineers. Read it before modifying any file
listed above.

#### 1. Demand-Driven Lazy Hydration

The previous architecture was server-authoritative: `ensureProfileComplete()`
eagerly computed ALL missing attributes whenever any attribute was absent. The
server decided what to compute, not the client.

This is now inverted. The UI drives compute. When `ParquetPreview` mounts, it
calls `useDataProfile(fileId, ['columnStats', 'cardinality', 'charLengths'])`.
The hook inspects the current profile, identifies which of those three are
`=== undefined` (never attempted), and sends a single request to
`GET /data-profile?attributes=columnStats,cardinality`. Attributes that are
`null` (negative-cached) are never re-requested.

The server's `hydrateAttributes()` function opens one DuckDB session per file,
computes only the missing set, and persists via JSONB merge. Concurrent requests
for the same file coalesce into a single DuckDB session via a module-level
`inflight` Map — the first request becomes the "leader," subsequent requests
await the leader's promise.

**Why this matters:** Future UI surfaces (e.g., a histogram panel, a column
lineage view) can request their own attributes without triggering compute for
attributes they don't need. The server never does work the client didn't ask for.

##### Parallel Hydration Axes

`useParquetPreview` now manages two independent state machines: `profileStatus`
(server-driven, fast) and `wasmStatus` (client-driven, slow). The profile axis
resolves as soon as `parquet-url` returns the cached JSONB — schema, rowCount,
and any previously enriched attributes are available immediately. The WASM axis
boots DuckDB and registers the Parquet file in the background. These axes run
in parallel; the sidebar (filters, stats, column names) renders on
`profileStatus === 'ready'` while the table body waits for `wasmReady`.

On a second visit to a fully-profiled file, the sidebar renders in sub-500ms
(single API round-trip to PostgreSQL) instead of blocking 2-4 seconds behind
DuckDB WASM boot. Filter widgets are interactive immediately — user input
accumulates in React state and applies automatically when WASM becomes ready
via a catch-up effect. If WASM fails, the sidebar still renders with full
profile data; only row scrolling is unavailable.

##### Global Hydration: Zero-Latency Navigation

The `GET /api/files` list endpoint is the **primary hydration source** for
`dataProfile`. Every file in the list response now includes its full JSONB
`dataProfile` blob. When `useFilesQuery` receives the response, it iterates
all files and calls `setFileProfile()` on the Zustand store for each one.
By the time the user clicks any file, the profile is already in memory.

`useParquetPreview` is designed to **favor the Zustand store over the
network**. On mount, it checks `getValidFileProfile(fileId)` before making
any API call. Three paths exist:

- **Fast path** — Zustand has both `dataProfile` and `parquetUrl` (valid,
  not expired). Zero network. Profile hydrates synchronously, WASM boots
  with the cached presigned URL.
- **Medium path** — Zustand has `dataProfile` but no `parquetUrl` (primed
  from the file list endpoint). Profile hydrates synchronously at 0ms
  (sidebar renders immediately). A single `parquet-url` fetch runs in the
  background to obtain the presigned S3 URL for WASM. This is the standard
  first-click path.
- **Slow path** — Nothing in Zustand (cold start, new file, expired TTL).
  Full `parquet-url` fetch, then profile hydration + WASM boot in parallel.

The medium path is the **definitive standard** for this platform. On a
server with 10 files, the file list primes all 10 profiles in a single
response. The first click on any file renders the sidebar at 0ms.

**NO-GO ZONE: Sequential WASM-gated rendering.** The UI must NEVER revert
to a pattern where sidebar rendering, filter controls, column names, row
counts, or any metadata display waits for DuckDB WASM to boot. WASM is for
row-level SQL operations (scrolling, filtering) only. If a future change
reintroduces a single status machine that gates metadata behind WASM
readiness, it is a regression. The two-axis architecture (`profileStatus` /
`wasmStatus`) and the Zustand-first lookup are load-bearing. Do not remove
them.

#### 2. The Velocity Engine (Constrained JSONB Debt)

The `data_profile` JSONB column on `genomic_files` is this project's most
important fast-iteration enabler. It is deliberate, constrained technical debt.

Traditional approach: each new metadata attribute (column stats, cardinality,
char lengths, histograms, percentiles, ...) requires a schema migration, a new
table or column, a DBA review, a deploy, and backward-compatibility logic.
At our current pace of feature discovery, that overhead would kill velocity.

Instead, `data_profile` acts as an **incubator**. New attributes are added by:

1. Adding one interface + one line to `EnrichableAttributes` in shared types
2. Adding one `case` to `hydrateAttribute()` on the server
3. Writing the enrichment function

No migration. No DBA. No deploy coordination. The JSONB column absorbs the
schema churn while the product is in rapid iteration. PostgreSQL's `||` operator
handles concurrent writes without clobbering — two requests computing different
attributes merge cleanly.

**This is not "schema-less by laziness."** It is schema-less by design, with a
strict type contract (see below) that prevents the debt from compounding.

#### 3. The Type Contract

The `EnrichableAttributes` interface in `packages/shared/src/data_profile.ts` is
the strict boundary that keeps JSONB debt from bleeding into application code.

```typescript
export interface EnrichableAttributes {
  columnStats: Record<string, DataProfileStats>;
  cardinality: Record<string, DataProfileCardinality>;
  charLengths: Record<string, DataProfileCharLengths>;
}

export type Lazy<T> = T | null;

export type DataProfile = {
  schema: DataProfileColumn[];
  rowCount: number;
  profiledAt?: string;
} & {
  [K in keyof EnrichableAttributes]?: Lazy<EnrichableAttributes[K]>;
};
```

The mapped type produces three compile-time states per attribute:

- `undefined` — never attempted, trigger compute
- `null` — attempted and failed, do not retry (negative cache / poison pill)
- `{...}` — data present, serve from cache

Both server and client are **forced** to handle all three states. You cannot
access `profile.columnStats.someColumn` without first narrowing past `undefined`
and `null`. The TypeScript compiler enforces what would otherwise be a runtime
convention.

Adding a new attribute (e.g., `histograms`) requires exactly one line in
`EnrichableAttributes`. The mapped type instantly propagates
`histograms?: Lazy<HistogramData>` to `DataProfile`, and every consumer that
destructures the profile gets a type error until they handle the new attribute.

#### 4. The Strangler Fig Migration Path

The `hydrateAttribute()` switch statement in `packages/server/src/lib/data_profile.ts`
is not just a dispatch table — it is the future migration router.

```typescript
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
      // ...same pattern
    case 'charLengths':
      // ...same pattern
  }
}
```

Today, every case reads from and writes to the JSONB blob. When an incubated
attribute matures and earns its own PostgreSQL column or table, its case
statement becomes the migration seam:

```typescript
case 'columnStats':
  if (profile.columnStats !== undefined) return;
  // Phase 1: Read from formal table, fall back to JSONB
  profile.columnStats = await readFromStatsTable(fileId)
    ?? await enrichColumnStats(session, profile);
  // Phase 2: Write to both (dual-write)
  await writeToStatsTable(fileId, profile.columnStats);
  return;
```

Eventually the JSONB fallback is removed, and the attribute lives in a proper
schema. The rest of the system — the endpoint, the client hook, the type
contract — never changes. This is the [Strangler Fig pattern](https://martinfowler.com/bliki/StranglerFigApplication.html)
applied to a single JSONB column.

The key insight: the switch statement serializes attribute hydration within a
single DuckDB session. This means the migration can be done per-attribute,
incrementally, without a flag day. Attribute A can be in a formal table while
attribute B is still in JSONB. The type system does not care where the data
lives — only that it arrives with the correct shape.

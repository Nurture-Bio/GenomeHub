# The Zero-Copy Pipeline: Arrow IPC Transport

**Date:** 2026-03-02
**Status:** Design — awaiting implementation

---

## The Opening Koan

$$\mathcal{L}_{\text{JSON}} = \sum_{i=0}^{N} \left( E_{\text{encode}}(x_i) + E_{\text{decode}}(x_i) \right) \gg \Delta t_{\text{memcpy}}$$

The latency of string serialization scales linearly with $N$. Converting a 64-bit IEEE float into `"0.987654"` introduces an algorithmic tax. Arrow IPC eliminates this: the wire carries the same bytes the CPU reads.

---

## 1. Problem

The current `POST /api/files/:id/query` endpoint:

1. DuckDB scans parquet → materializes JS objects via `stmt.all()`
2. Server runs `JSON.stringify()` → UTF-8 string over HTTP
3. Client runs `JSON.parse()` → allocates JS objects → stuffs into `Map<number, Record>`
4. Virtualizer reads from the Map

The JSON River. 200 rows × 23 columns → **~35KB JSON** on the wire, with full V8 GC pressure on both ends. BigInt values crash `JSON.stringify` entirely.

## 2. Solution

Replace JSON with Apache Arrow IPC binary transport. The bits flow untouched from DuckDB's vectorized engine through the TCP socket into the client's TypedArrays.

### Verified Foundation

| Capability | Status |
|---|---|
| `@duckdb/node-api` (N-API bindings) | Installed, working |
| Community `arrow` extension | Installs and loads on DuckDB 1.4.4 |
| `to_arrow_ipc()` SQL function | Returns `DuckDBBlobValue` with `.bytes` accessor |
| `$1` parameterized queries through `to_arrow_ipc()` | Working |
| `apache-arrow` `tableFromIPC()` client-side | Decodes to `Int32Array`, `Float64Array` directly |
| 200-row viewport query as Arrow IPC | **49,312 bytes**, 54ms |
| God Query (1-row aggregates) as Arrow IPC | **760 bytes**, 4ms |

## 3. Architecture

### Wire Protocol

Two Arrow IPC tables in one HTTP response, length-prefixed:

```
Content-Type: application/vnd.apache.arrow.stream

[4 bytes LE: god_table_length]
[god_table_length bytes: God Query Arrow IPC]
[remaining bytes: Viewport Arrow IPC]
```

The God Query table (1 row) carries:
- `total_rows: INT32` — filtered count
- `{col}_min: DOUBLE`, `{col}_max: DOUBLE` — constrained stats per numeric column
- `{col}_hist: INT32[64]` — dynamic histogram per numeric column (LIST type)

The Viewport table (N rows) carries:
- All columns in native DuckDB types (no BigInt→Number coercion, no string formatting)

### Server (`query.ts`)

```
Request  → validate filters/sort against schema allowlist
         → compile WHERE/ORDER BY with $N parameter placeholders
         → execute God Query via to_arrow_ipc() → DuckDBBlobValue[].bytes
         → execute Viewport Query via to_arrow_ipc() → DuckDBBlobValue[].bytes
         → write length-prefixed binary frames to res
         → Content-Type: application/vnd.apache.arrow.stream
```

Node never examines a single byte of the payload. It is the conduit.

### Client (`useParquetPreview.ts`)

```
Response → arrayBuffer()
         → slice god table by length prefix → tableFromIPC()
         → slice viewport table → tableFromIPC()
         → God table: .getChild('total_rows').get(0) → filteredCount
         → God table: .getChild('score_hist').toArray() → Int32Array (64 bins)
         → Viewport table: .toArray() per column → TypedArrays for rendering
```

Zero `JSON.parse`. The GhostHistogramLens reads directly from Arrow memory.

## 4. Changes Required

### Package Changes
- **Remove:** `duckdb` (legacy C++ bindings, broken Arrow, segfaults)
- **Add:** `@duckdb/node-api` (modern N-API, Promise-native)
- **Add:** `apache-arrow` to server (already available via hoist, but declare explicitly)

### Server Files
- **Rewrite:** `packages/server/src/routes/query.ts` — new DuckDB API, Arrow IPC output
- **Update:** `packages/server/src/lib/data_profile.ts` — migrate from `duckdb` to `@duckdb/node-api`
- **Update:** Any other server file importing from `duckdb` directly

### Client Files
- **Update:** `packages/client/src/hooks/useParquetPreview.ts` — `serverQuery()` returns `ArrayBuffer`, decode with `tableFromIPC()`
- **Update:** `packages/client/src/components/ParquetPreview.tsx` — VirtualRows reads from Arrow vectors instead of `Record<string, unknown>` Map

### Histogram Integration

God Query SQL now includes per-column histogram aggregation via `LIST`:

```sql
SELECT
  COUNT(*)::INTEGER AS total_rows,
  MIN(score)::DOUBLE AS score_min,
  MAX(score)::DOUBLE AS score_max,
  LIST(hist_bucket ORDER BY bucket) AS score_hist
FROM (
  SELECT
    score,
    FLOOR((score::DOUBLE - $min) / ($max - $min) * 64)::INTEGER AS bucket,
    ...
  FROM read_parquet(...)
  WHERE ...
)
```

Or separate per-column histogram queries concatenated into the God Query Arrow table.

## 5. Security

- Column names validated against schema allowlist (unchanged)
- Filter values use `$N` parameterized queries through `to_arrow_ipc()` (verified working)
- No SQL injection surface — `to_arrow_ipc()` wraps the parameterized inner query

## 6. What We Do NOT Change

- The filter sidebar, range sliders, categorical selects — unchanged
- The pipeline FSM states — unchanged
- The data profile hydration flow — unchanged
- The upload/conversion pipeline — unchanged (except migrating `duckdb` imports)

## 7. The Closing Meditation

A stream of binary floats knows no commas, no brackets, no human context. It is the pure physical resonance of the Parquet stone, struck by the DuckDB hammer, ringing continuously across the network into the client's TypedArrays. The translation layer is obliterated. The system is whole.

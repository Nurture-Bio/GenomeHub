# LOO Histograms: Fold into God Query

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold per-column LOO histograms into the god query's CTE, eliminating N separate parquet scans and enabling cross-attribute correlation visibility in the histogram UI.

**Architecture:** Extend `buildLooQueries` to add `histogram(bucket_expr) FILTER (WHERE other_masks)` aggregates to the existing god query SELECT. The god query already materializes the CTE with boolean masks — histograms ride on the same scan at zero marginal I/O cost. DuckDB's native `histogram()` returns `MAP(INT32, UBIGINT)` which serializes through `to_arrow_ipc()` and is readable by Apache Arrow JS as `MapRow` (iterable `[key, value]` pairs). Client unpacks MAPs into `number[64]` with zero-fill.

**Tech Stack:** DuckDB `histogram()` aggregate, Arrow IPC MAP serialization, Apache Arrow JS `MapRow`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/routes/query.ts` | Modify | Extend `buildLooQueries` return type; add histogram aggregates to god SQL; delete histogram query builder + execution loop; simplify wire format (3 tables max) |
| `packages/client/src/hooks/useFileQuery.ts` | Modify | Replace `parseHistTable` with MAP unpacking in `parseGodTable`; simplify table demux (no histogram index arithmetic) |

**Untouched:** `packages/shared/src/data_profile.ts` (`histogramBucketSql` still used), RangeSlider, ControlCenter, QueryWorkbench, export endpoint, static profile histograms.

---

## Chunk 1: Server — Fold Histograms into God Query

### Task 1: Extend `buildLooQueries` to emit histogram aggregates

**Files:**
- Modify: `packages/server/src/routes/query.ts:143-219`

The function currently returns `{ godSql, stateSql, params, maskColumns }`. We add histogram columns and a list of which columns have histograms.

- [ ] **Step 1: Add `histCols` and `columnStats` parameters to `buildLooQueries`**

Change the function signature from:

```typescript
function buildLooQueries(
  readParquet: string,
  filters: FilterSpec[],
  colMap: Map<string, FlatColumn>,
  numericCols: FlatColumn[],
): { godSql: string; stateSql: string | null; params: DuckDBValue[]; maskColumns: string[] } {
```

to:

```typescript
function buildLooQueries(
  readParquet: string,
  filters: FilterSpec[],
  colMap: Map<string, FlatColumn>,
  numericCols: FlatColumn[],
  histCols: FlatColumn[],
  columnStats: Record<string, DataProfileStats>,
): { godSql: string; stateSql: string | null; params: DuckDBValue[]; maskColumns: string[]; histColNames: string[] } {
```

- [ ] **Step 2: Add histogram aggregates after the MIN/MAX loop (after line 202)**

After the existing `for (const col of numericCols)` loop that builds MIN/MAX aggregates, add:

```typescript
  // Phase 2c: LOO histograms — native histogram() on pre-bucketed values
  const histColNames: string[] = [];
  for (const col of histCols) {
    const s = columnStats[col.name];
    const bucket = histogramBucketSql(col.sqlExpr, s.min, s.max);
    const otherMasks = maskDefs
      .filter((m) => m.column !== col.name)
      .map((m) => m.alias);
    const nullGuard = `${col.sqlExpr} IS NOT NULL`;
    const filterParts = [...otherMasks, nullGuard];
    const filterClause = ` FILTER (WHERE ${filterParts.join(' AND ')})`;
    aggregates.push(`histogram(${bucket})${filterClause} AS ${safeName('hist_' + col.name)}`);
    histColNames.push(col.name);
  }
```

- [ ] **Step 3: Add `histColNames` to the return value**

Change the return statement from:

```typescript
  return { godSql, stateSql, params, maskColumns };
```

to:

```typescript
  return { godSql, stateSql, params, maskColumns, histColNames };
```

- [ ] **Step 4: Rebuild the server**

Run: `cd packages/server && npm run build`
Expected: Clean compile (no type errors)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/query.ts
git commit -m "feat: add LOO histogram aggregates to buildLooQueries"
```

---

### Task 2: Update call site and delete histogram query infrastructure

**Files:**
- Modify: `packages/server/src/routes/query.ts:325-430`

- [ ] **Step 1: Split `buildLooQueries` into two calls — preflight (no histograms) and full query**

The preflight god query must stay fast (count + stats only). Replace the single call site with two calls gated on `mode`:

Change from:

```typescript
      const { godSql, stateSql, params: godParams, maskColumns } = buildLooQueries(
        readParquet, filters, colMap, numericCols,
      );

      // ── Preflight mode: god query only (count + stats, no rows/histograms) ──
      if (mode === 'preflight') {
```

to:

```typescript
      // ── Preflight mode: god query only (count + stats, no histograms) ──
      if (mode === 'preflight') {
        const { godSql, params: godParams } = buildLooQueries(
          readParquet, filters, colMap, numericCols, [], {},
        );
```

Then close the preflight block as before, and after it add the full-query call:

```typescript
      const { godSql, stateSql, params: godParams, maskColumns, histColNames } = buildLooQueries(
        readParquet, filters, colMap, numericCols, histCols, columnStats!,
      );
```

**Safety invariant:** `columnStats!` is safe because `histCols` is already filtered by `if (!columnStats) return false` — when `columnStats` is null, `histCols` is empty, so `buildLooQueries` never accesses `columnStats`.

- [ ] **Step 2: Delete the histogram query builder block (lines 364-381)**

Delete entirely:

```typescript
      // ── Per-column histogram queries (zero-filled via generate_series) ───

      const histQueryBuilders = histCols.map((col) => {
        const s = columnStats![col.name];
        const bucket = histogramBucketSql(col.sqlExpr, s.min, s.max);
        const nullJoin = whereClause ? 'AND' : 'WHERE';
        const sql =
          `WITH counts AS (` +
          `SELECT ${bucket} AS bucket, COUNT(*)::INTEGER AS cnt ` +
          `FROM ${readParquet} ${whereClause} ${nullJoin} ${col.sqlExpr} IS NOT NULL ` +
          `GROUP BY bucket` +
          `), all_bins AS (` +
          `SELECT generate_series AS bucket FROM generate_series(0, ${HISTOGRAM_BINS - 1})` +
          `) SELECT a.bucket::INTEGER AS bucket, COALESCE(c.cnt, 0)::INTEGER AS cnt ` +
          `FROM all_bins a LEFT JOIN counts c ON a.bucket = c.bucket ` +
          `ORDER BY a.bucket`;
        return { sql, params: [...whereParams] };
      });
```

- [ ] **Step 3: Simplify `numTables` and headers (lines 392-401)**

Change from:

```typescript
      const hasStateMatrix = stateSql !== null;
      const numTables = 2 + histQueryBuilders.length + (hasStateMatrix ? 1 : 0);

      res.setHeader('Content-Type', 'application/vnd.apache.arrow.stream');
      res.setHeader('X-Arrow-Tables', numTables.toString());
      res.setHeader('X-Hist-Columns', histCols.map((c) => c.name).join(','));
      // Bit position → column name mapping for the state matrix
      if (hasStateMatrix) {
        res.setHeader('X-State-Columns', maskColumns.join(','));
      }

      res.write(writeU32LE(numTables));
```

to:

```typescript
      const hasStateMatrix = stateSql !== null;
      const numTables = 2 + (hasStateMatrix ? 1 : 0);

      res.setHeader('Content-Type', 'application/vnd.apache.arrow.stream');
      res.setHeader('X-Arrow-Tables', numTables.toString());
      res.setHeader('X-Hist-Columns', histColNames.join(','));
      if (hasStateMatrix) {
        res.setHeader('X-State-Columns', maskColumns.join(','));
      }

      res.write(writeU32LE(numTables));
```

- [ ] **Step 4: Delete the histogram execution loop (lines 417-430)**

Delete entirely:

```typescript
      // 3. Histograms — one per numeric column, flushed individually
      for (const h of histQueryBuilders) {
        if (clientGone) break;
        try {
          const histBuf = await arrowQuery(conn, h.sql, h.params);
          if (clientGone) break;
          res.write(writeU32LE(histBuf.byteLength));
          res.write(histBuf);
        } catch {
          if (clientGone) break;
          // Empty frame — client sees 0-length table
          res.write(writeU32LE(0));
        }
      }
```

- [ ] **Step 5: Update the comment on step 4 (state matrix) to say step 3**

Change `// 4. State matrix` to `// 3. State matrix`.

- [ ] **Step 6: Update the module docstring (lines 1-33)**

Replace the wire format description with:

```typescript
/**
 * Server-side query endpoint — Arrow IPC binary transport.
 *
 * POST /:id/query
 *   Request:  JSON { filters, sort, offset, limit }
 *   Response: Binary Arrow IPC frames (zero JSON on the data path)
 *
 * Wire format:
 *   [4 bytes LE: num_tables]
 *   For each table:
 *     [4 bytes LE: table_byte_length]
 *     [table_byte_length bytes: Arrow IPC]
 *   Table order: [viewport, god_query, state_matrix?]
 *
 * The God Query table (1 row) carries:
 *   - total_rows: INT32
 *   - {col}_min / {col}_max: DOUBLE (LOO constrained stats per numeric column)
 *   - hist_{col}: MAP(INT32, UBIGINT) (LOO histogram per numeric column with variance)
 *
 * Histograms use Leave-One-Out (LOO) filtering: each column's histogram
 * reflects all active filters EXCEPT its own, enabling cross-attribute
 * correlation visibility.
 *
 * Security: column names validated against schema allowlist; all filter values
 * use $N parameterized queries. Zero SQL injection.
 *
 * @module
 */
```

- [ ] **Step 7: Remove unused `HISTOGRAM_BINS` import if no longer referenced**

Check if `HISTOGRAM_BINS` is still used. It was only used in the deleted histogram query builder. `histogramBucketSql` is still imported and used in `buildLooQueries`. Remove `HISTOGRAM_BINS` from the import:

Change:
```typescript
import { HISTOGRAM_BINS, histogramBucketSql, detectFormat } from '@genome-hub/shared';
```
to:
```typescript
import { histogramBucketSql, detectFormat } from '@genome-hub/shared';
```

- [ ] **Step 8: Rebuild the server**

Run: `cd packages/server && npm run build`
Expected: Clean compile

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/routes/query.ts
git commit -m "feat: fold LOO histograms into god query, delete N separate histogram scans"
```

---

## Chunk 2: Client — Parse MAP Columns from God Table

### Task 3: Replace histogram parsing with MAP unpacking

**Files:**
- Modify: `packages/client/src/hooks/useFileQuery.ts:229-262, 400-462`

- [ ] **Step 1: Expand `parseGodTable` to extract histogram MAPs (lines 229-252)**

Replace the existing `parseGodTable` function with:

```typescript
function parseGodTable(
  godTable: ArrowTable,
  histColNames: string[],
): {
  filteredCount: number;
  constrainedStats: Record<string, { min: number; max: number }>;
  dynamicHistograms: Record<string, number[]>;
} {
  const filteredCount = Number(godTable.getChild('total_rows')?.get(0) ?? 0);
  const constrainedStats: Record<string, { min: number; max: number }> = {};

  for (const field of godTable.schema.fields) {
    const match = field.name.match(/^"?(.+?)_min"?$/);
    if (match) {
      const colName = match[1];
      const minVal = godTable.getChild(field.name)?.get(0);
      const maxFieldName = field.name.replace(/_min"?$/, '_max"');
      const altMaxName = field.name.replace(/_min$/, '_max');
      const maxVal =
        godTable.getChild(maxFieldName)?.get(0) ?? godTable.getChild(altMaxName)?.get(0);
      if (minVal != null && maxVal != null) {
        constrainedStats[colName] = { min: Number(minVal), max: Number(maxVal) };
      }
    }
  }

  // Unpack histogram MAP columns: MAP(INT32, UBIGINT) → number[HISTOGRAM_BINS]
  // Defensive getChild: try unquoted, then quoted (DuckDB/Arrow may preserve quotes)
  const dynamicHistograms: Record<string, number[]> = {};
  for (const colName of histColNames) {
    const fieldName = `hist_${colName}`;
    const mapVec = godTable.getChild(fieldName) ?? godTable.getChild(`"${fieldName}"`);
    const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
    if (mapVec) {
      const mapRow = mapVec.get(0);
      if (mapRow) {
        for (const [bucket, count] of mapRow) {
          const idx = Number(bucket);
          if (idx >= 0 && idx < HISTOGRAM_BINS) bins[idx] = Number(count);
        }
      }
    }
    dynamicHistograms[colName] = bins;
  }

  return { filteredCount, constrainedStats, dynamicHistograms };
}
```

- [ ] **Step 1b: Add `HISTOGRAM_BINS` import to the client**

Add to the existing imports at the top of `useFileQuery.ts`:

```typescript
import { HISTOGRAM_BINS } from '@genome-hub/shared';
```

- [ ] **Step 2: Delete `parseHistTable` (lines 254-262)**

Delete entirely:

```typescript
function parseHistTable(histTable: ArrowTable): number[] {
  const cntVec = histTable.getChild('cnt');
  if (!cntVec) return new Array(64).fill(0);
  const bins = new Array<number>(cntVec.length);
  for (let i = 0; i < cntVec.length; i++) {
    bins[i] = Number(cntVec.get(i) ?? 0);
  }
  return bins;
}
```

- [ ] **Step 3: Simplify `serverQuery` table demux (lines 400-462)**

Replace the table demux logic in `serverQuery`. The key changes:
- Pass `histColNames` to `parseGodTable`
- Remove histogram index tracking
- State matrix is now at index 2 (was `2 + histColNames.length`)
- `dynamicHistograms` comes from `parseGodTable`, not separate tables

Replace the body of `serverQuery` from the headers section onward:

```typescript
  const histColHeader = res.headers.get('X-Hist-Columns') ?? '';
  const histColNames = histColHeader ? histColHeader.split(',') : [];
  const stateColHeader = res.headers.get('X-State-Columns') ?? '';
  const stateColNames = stateColHeader ? stateColHeader.split(',') : [];
  const hasStateMatrix = stateColNames.length >= 2;

  let filteredCount = 0;
  let constrainedStats: Record<string, { min: number; max: number }> = {};
  let viewportTable: ArrowTable | null = null;
  let dynamicHistograms: Record<string, number[]> = {};
  let stateMatrix: StateMatrix | null = null;

  // Table indices: 0=viewport, 1=god (includes histograms as MAP columns), 2=state matrix (if present)
  for await (const { index, table } of streamArrowFrames(res.body!)) {
    if (!table) continue;

    if (index === 0) {
      viewportTable = table;
      callbacks?.onViewport?.(table);
    } else if (index === 1) {
      const god = parseGodTable(table, histColNames);
      filteredCount = god.filteredCount;
      constrainedStats = god.constrainedStats;
      dynamicHistograms = god.dynamicHistograms;
      callbacks?.onGod?.(god);
    } else if (index === 2 && hasStateMatrix) {
      stateMatrix = parseStateMatrix(table, stateColNames);
    }
  }

  return { viewportTable, filteredCount, constrainedStats, dynamicHistograms, stateMatrix };
```

- [ ] **Step 4: Update `StreamCallbacks.onGod` type to include histograms (lines 218-225)**

Change the `onGod` callback type:

```typescript
interface StreamCallbacks {
  onGod?: (god: {
    filteredCount: number;
    constrainedStats: Record<string, { min: number; max: number }>;
    dynamicHistograms: Record<string, number[]>;
  }) => void;
  onViewport?: (table: ArrowTable) => void;
}
```

- [ ] **Step 5: Update the preflight god parse (lines 760-771)**

The preflight path calls `parseGodTable` too. Update it to pass empty histColNames (preflight doesn't need histograms):

Change:
```typescript
              const god = parseGodTable(table);
```
to:
```typescript
              const god = parseGodTable(table, []);
```

- [ ] **Step 6: Update the `onGod` callback in the Basin (lines 779-784)**

The `onGod` callback in the Basin currently only dispatches `count`. It doesn't need to change — the callback destructures only `filteredCount`. No change needed here, but verify the destructuring still works:

```typescript
        onGod: ({ filteredCount: fc }) => {
```

This still works because the new return type is a superset.

- [ ] **Step 7: Update the wire format comment (lines 339-342)**

Change:
```typescript
//   Table order: viewport, god, hist_0, hist_1, ...
```
to:
```typescript
//   Table order: viewport, god (with histogram MAPs), state_matrix?
```

- [ ] **Step 8: Verify the client builds**

Run: `cd packages/client && npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/hooks/useFileQuery.ts
git commit -m "feat: parse LOO histograms from god query MAP columns, delete separate table demux"
```

---

## Chunk 3: Smoke Test

### Task 4: End-to-end verification

- [ ] **Step 1: Rebuild server**

```bash
npm run build -w packages/server
```

- [ ] **Step 2: Start dev environment and verify**

Start the server and client. Open a file in QueryWorkbench. Verify:
1. Histograms render (spring-animated bars appear in RangeSliders)
2. Drag a slider — other histograms reshape (LOO cross-correlation visible)
3. Clear all filters — histograms return to full-data shape
4. State matrix correlation glyphs still function (with 2+ filters active)
5. No console errors in browser or server

- [ ] **Step 3: Verify preflight mode still works**

Open the QueryWorkbench drawer. Filters should show count updates immediately (preflight) before the full query completes. The preflight response is now 1 table (god without histograms), which is correct — preflight passes `[]` for histColNames.

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "test: verify LOO histograms end-to-end"
```

---

## What Changed (Summary)

| Before | After |
|--------|-------|
| God query: 1 CTE scan (stats only) | God query: 1 CTE scan (stats + histograms) |
| N histogram queries: N separate parquet scans | Eliminated — zero additional scans |
| Wire format: 2 + N + state tables | Wire format: 2 + state tables (3 max) |
| Histogram WHERE: all filters (tautological) | Histogram FILTER: LOO (cross-correlation) |
| `parseHistTable`: 64-row Arrow table → `number[]` | MAP unpacking: `MapRow` → `number[64]` with zero-fill |
| Table demux: index arithmetic with histogram count | Table demux: fixed indices (0=viewport, 1=god, 2=state) |

## Trade-offs

**Error resilience:** The old code had per-histogram try/catch — a failed histogram wrote a zero-length frame without taking down the god query. Now histograms are aggregates inside the god query — if `histogram()` throws, the entire god query fails. In practice, `histogram()` on clamped integers with a FILTER clause cannot fail independently of MIN/MAX (same data, same masks). An all-NULL column produces an empty MAP, which the client zero-fills correctly.

**Preflight performance:** Preflight calls `buildLooQueries` with `histCols: []`, so the preflight god query contains zero histogram aggregates — no regression.

## Lines Deleted vs Added (Estimate)

- **Server**: ~30 lines deleted (histogram builder + execution loop), ~10 lines added (histogram aggregates in `buildLooQueries`)
- **Client**: ~30 lines deleted (`parseHistTable` + histogram demux logic), ~20 lines added (MAP unpacking in `parseGodTable`)
- **Net**: ~30 lines fewer code

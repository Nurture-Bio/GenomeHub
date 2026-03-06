# Perceptual Instantaneity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate perceived latency on filter → table update by reordering server frame emission, separating render phases, and adding speculative preflight queries.

**Architecture:** Three independent patterns. A (frame reorder) is server + client. D (render separation) is client-only React memo restructure. B (speculative preflight) adds a new `SpeculativeQuery` interface and modifies the Basin effect. Each pattern can be shipped independently.

**Tech Stack:** Express, DuckDB Node, Arrow IPC, React 19, TanStack Virtual

---

### Task 1: Frame Priority Inversion — Server Reorder

Emit viewport rows before god query. A `SELECT * LIMIT 50` stops at the first qualifying row group (~100ms). The god query (`COUNT(*) + MIN/MAX`) requires a full scan (~1-2s). Users see rows before the count badge updates.

**Files:**
- Modify: `packages/server/src/routes/query.ts:263-291`
- Modify: `packages/client/src/hooks/useFileQuery.ts:348-367`

**Step 1: Reorder server frame emission**

In `packages/server/src/routes/query.ts`, swap the god and viewport execution order. The wire format stays identical (4-byte LE length prefix per frame), just the frame order changes.

Current order (lines 271-279):
```typescript
// 1. God Query
const godBuf = await arrowQuery(conn, godSql, whereParams);
res.write(writeU32LE(godBuf.byteLength));
res.write(godBuf);

// 2. Viewport
const viewportBuf = await arrowQuery(conn, viewportSql, viewportParams);
res.write(writeU32LE(viewportBuf.byteLength));
res.write(viewportBuf);
```

New order:
```typescript
// 1. Viewport — paginated rows (fastest: stops at first qualifying row group)
const viewportBuf = await arrowQuery(conn, viewportSql, viewportParams);
res.write(writeU32LE(viewportBuf.byteLength));
res.write(viewportBuf);

// 2. God Query — count + constrained stats (full scan)
const godBuf = await arrowQuery(conn, godSql, whereParams);
res.write(writeU32LE(godBuf.byteLength));
res.write(godBuf);
```

Also update the wire format comment at the top of the file (lines 9-11, 27) to reflect the new order: `[viewport, god_query, hist_col_0, hist_col_1, ...]`.

**Step 2: Update client frame index mapping**

In `packages/client/src/hooks/useFileQuery.ts`, swap the index checks in `serverQuery`:

Current (lines 348-367):
```typescript
if (index === 0) {
  // God Query
  const god = parseGodTable(table);
  ...
  callbacks?.onGod?.(god);
} else if (index === 1) {
  // Viewport
  viewportTable = table;
  callbacks?.onViewport?.(table);
} else {
  // Histogram frame
  ...
}
```

New:
```typescript
if (index === 0) {
  // Viewport — rows arrive first
  viewportTable = table;
  callbacks?.onViewport?.(table);
} else if (index === 1) {
  // God Query — count + constrained stats
  const god = parseGodTable(table);
  filteredCount = god.filteredCount;
  constrainedStats = god.constrainedStats;
  callbacks?.onGod?.(god);
} else {
  // Histogram frame
  if (histIndex < histColNames.length) {
    dynamicHistograms[histColNames[histIndex]] = parseHistTable(table);
  }
  histIndex++;
}
```

Also update the JSDoc comment above `serverQuery` (lines 309-316) and the module header of `useFileQuery.ts` to reflect viewport-first order.

**Step 3: Rebuild server and verify**

Run: `npm run build -w packages/server`
Run: `npm run build -w packages/client`
Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: All clean.

**Step 4: Commit**

```bash
git add packages/server/src/routes/query.ts packages/client/src/hooks/useFileQuery.ts
git commit -m "perf: viewport-first frame emission — rows before count"
```

---

### Task 2: Render Phase Separation — Split deriveViewState

Decouple structural UI state (skeleton, flow, convergence) from data state (count, stats, histograms). The god frame arrival (count update) currently cascades into all 20+ RangeSliders via `viewState` recomputation. After this change, count updates only touch the count badge.

**Files:**
- Modify: `packages/client/src/components/QueryWorkbench.tsx:167-178, 180-229, 934-946, 1298-1355`

**Step 1: Split ViewState into StructuralState + DataState**

Replace the single `ViewState` interface and `deriveViewState` function with two separate derivations.

Current `ViewState` interface (lines 167-178):
```typescript
interface ViewState {
  convergenceStep: number;
  convergenceSteps: StepperStep[];
  isReady: boolean;
  isTerminal: boolean;
  flowState: 'normal' | 'pending' | 'stalled';
  flowLabel: string | undefined;
  isPending: boolean;
  hasFilter: boolean;
  noResults: boolean;
  showSkeleton: boolean;
}
```

New — split into two interfaces:
```typescript
interface StructuralState {
  convergenceStep: number;
  convergenceSteps: StepperStep[];
  isReady: boolean;
  isTerminal: boolean;
  flowState: 'normal' | 'pending' | 'stalled';
  flowLabel: string | undefined;
  isPending: boolean;
  showSkeleton: boolean;
}

interface DataState {
  hasFilter: boolean;
  noResults: boolean;
}
```

**Step 2: Split deriveViewState into two functions**

```typescript
function deriveStructuralState(
  lifecycle: { phase: QueryPhase; error: string | null; queryError: Error | string | null; isQuerying: boolean },
  isFetchingRange: boolean,
  cacheGen: number,
): StructuralState {
  const { phase, error, queryError, isQuerying } = lifecycle;
  const convergenceStep = deriveConvergenceStep(phase, isQuerying, isFetchingRange, cacheGen);
  const isTerminal = phase === 'error' || phase === 'failed' || phase === 'unavailable';
  const isReady = phase === 'ready' || phase === 'ready_background_work';
  const displayError = isTerminal ? error : undefined;
  const convergenceSteps: StepperStep[] = displayError
    ? CONVERGENCE_STEPS.map((s, i) => (i === convergenceStep ? { ...s, error: displayError } : s))
    : [...CONVERGENCE_STEPS];
  const flowState: StructuralState['flowState'] = queryError ? 'stalled' : isQuerying ? 'pending' : 'normal';
  const flowLabel = queryError ? 'query failed' : undefined;
  const isPending = isQuerying || isFetchingRange;
  const showSkeleton = convergenceStep < 2 || (convergenceStep === 2 && cacheGen === 0);
  return { convergenceStep, convergenceSteps, isReady, isTerminal, flowState, flowLabel, isPending, showSkeleton };
}

function deriveDataState(filterCount: number, count: number): DataState {
  const hasFilter = filterCount > 0;
  const noResults = hasFilter && count === 0;
  return { hasFilter, noResults };
}
```

**Step 3: Split the useMemo into two**

Replace the single `viewState` memo (lines 934-946) with:

```typescript
const structural = useMemo(
  () => deriveStructuralState(lifecycle, isFetchingRange, cacheGen),
  [lifecycle.phase, lifecycle.error, lifecycle.queryError, lifecycle.isQuerying, isFetchingRange, cacheGen],
);

const dataState = useMemo(
  () => deriveDataState(filters.specs.length, snapshot.count),
  [filters.specs.length, snapshot.count],
);
```

**Step 4: Update all consumption sites**

Search for `viewState.` in QueryWorkbench.tsx and replace with `structural.` or `dataState.` as appropriate:

| Old | New | Location |
|-----|-----|----------|
| `viewState.convergenceStep` | `structural.convergenceStep` | Stepper |
| `viewState.convergenceSteps` | `structural.convergenceSteps` | Stepper |
| `viewState.showSkeleton` | `structural.showSkeleton` | Skeleton overlay |
| `viewState.isTerminal` | `structural.isTerminal` | Early return |
| `viewState.isReady` | `structural.isReady` | VirtualRows guard |
| `viewState.flowState` | `structural.flowState` | RiverGauge |
| `viewState.flowLabel` | `structural.flowLabel` | RiverGauge |
| `viewState.isPending` | `structural.isPending` | (check all usages) |
| `viewState.hasFilter` | `dataState.hasFilter` | ControlCenter, RiverGauge |
| `viewState.noResults` | `dataState.noResults` | ControlCenter |

**Step 5: Verify and commit**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Run: `npm run build -w packages/client`
Expected: Clean.

```bash
git add packages/client/src/components/QueryWorkbench.tsx
git commit -m "perf: split viewState — structural vs data render phases"
```

---

### Task 3: Extract RangeSliderCard as Memoized Component

Currently ControlCenter renders all filter cards via an inline `renderColumnCard` function. When any histogram updates, all cards re-render. Extract each card type into a memoized component so only the card whose histogram changed re-renders.

**Files:**
- Modify: `packages/client/src/components/QueryWorkbench.tsx` (ControlCenter section, lines ~486-623)

**Step 1: Extract RangeSliderCard**

Create a memoized component wrapping the numeric card rendering logic. Place it above the ControlCenter definition in the same file (this keeps the diff minimal — no new file needed since ControlCenter is already in QueryWorkbench.tsx).

```typescript
const RangeSliderCard = React.memo(function RangeSliderCard({
  column,
  stats,
  constrainedStats,
  rangeState,
  hasAnyFilter,
  isQuerying,
  staticHistogram,
  dynamicHistogram,
  onDrag,
  onCommit,
  visible,
  onToggleVisible,
}: {
  column: ColumnInfo;
  stats: ColumnStats;
  constrainedStats: ColumnStats | undefined;
  rangeState: [number, number] | undefined;
  hasAnyFilter: boolean;
  isQuerying: boolean;
  staticHistogram: number[] | undefined;
  dynamicHistogram: number[] | undefined;
  onDrag: (name: string, lo: number, hi: number) => void;
  onCommit: (name: string, lo: number, hi: number) => void;
  visible: boolean;
  onToggleVisible: (name: string) => void;
}) {
  // Extract the numeric card rendering logic from renderColumnCard
  // (the RangeSlider instantiation + constant badge + eye toggle)
});
```

**Step 2: Update ControlCenter to use RangeSliderCard**

In the `numerics.map(...)` section, replace the inline `renderColumnCard(c)` call with `<RangeSliderCard key={c.name} column={c} ... />`, passing individual props from the dictionaries.

The key insight: `dynamicHistogram={constrainedHistograms[c.name]}` extracts a single array reference. React.memo compares this reference — if this column's histogram didn't change, the card skips re-render even when the parent's `constrainedHistograms` object changed.

**Step 3: Verify and commit**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Run: `npm run build -w packages/client`

```bash
git add packages/client/src/components/QueryWorkbench.tsx
git commit -m "perf: memoized RangeSliderCard — O(1) histogram updates"
```

---

### Task 4: SpeculativeQuery Interface + Basin Preflight

Fire a lightweight server query immediately when `filterKey` changes (0ms). The 80ms-debounced full query still fires on schedule. If the preflight returns before the full query fires and the params match, promote the preflight's count + stats into the snapshot.

**Files:**
- Create: `packages/client/src/lib/SpeculativeQuery.ts`
- Modify: `packages/client/src/hooks/useFileQuery.ts` (Basin effect, lines ~618-666)
- Modify: `packages/server/src/routes/query.ts` (add lightweight mode)

**Step 1: Create SpeculativeQuery interface**

```typescript
// packages/client/src/lib/SpeculativeQuery.ts

/**
 * SpeculativeQuery — async preflight that fires before the debounced full query.
 *
 * The consumer fires `fire()` immediately on filter change. If the preflight
 * returns before the full query fires and `canPromote()` returns true,
 * the preflight result is merged into the snapshot — the user sees count + stats
 * before the full query would have even started.
 *
 * TParams: query parameters (e.g. FilterSpec[] + SortSpec[])
 * TOutput: partial result (e.g. { count, stats })
 */
export interface SpeculativeQuery<TParams, TOutput> {
  /** Fire a lightweight speculative query. Caller manages abort via signal. */
  fire(params: TParams, signal: AbortSignal): Promise<TOutput>;
  /** Can the preflight result be promoted? True if params haven't diverged. */
  canPromote(preflightParams: TParams, commitParams: TParams): boolean;
}
```

**Step 2: Add lightweight query mode to server**

In `packages/server/src/routes/query.ts`, add support for `mode: 'preflight'` in the request body. When `mode === 'preflight'`:
- Skip viewport query (no rows)
- Skip histogram queries
- Return only the god query frame (count + constrained stats)
- `numTables = 1`

```typescript
const {
  filters = [] as FilterSpec[],
  sort = [] as SortSpec[],
  offset = 0,
  limit = 50,
  mode,
} = req.body as {
  filters?: FilterSpec[];
  sort?: SortSpec[];
  offset?: number;
  limit?: number;
  mode?: 'preflight';
};

// ... (validation unchanged)

if (mode === 'preflight') {
  // Lightweight: god query only
  res.setHeader('Content-Type', 'application/vnd.apache.arrow.stream');
  res.setHeader('X-Arrow-Tables', '1');
  res.setHeader('X-Hist-Columns', '');
  res.write(writeU32LE(1));
  const godBuf = await arrowQuery(conn, godSql, whereParams);
  res.write(writeU32LE(godBuf.byteLength));
  res.write(godBuf);
  conn.closeSync();
  res.end();
  return;
}

// ... (full query path unchanged, but now viewport-first from Task 1)
```

**Step 3: Add preflight to Basin effect**

In `useFileQuery.ts`, modify the Basin effect to fire a preflight immediately (0ms) alongside the debounced full query (80ms). Add a `preflightRef` to track the in-flight preflight.

```typescript
// New ref alongside existing abortRef
const preflightRef = useRef<{ abort: AbortController; filterKey: string } | null>(null);

useEffect(() => {
  if (state.phase !== 'ready' && state.phase !== 'ready_background_work') return;

  const filters = activeFilterSpecs ?? [];
  const sort = sortSpecs ?? [];
  const currentFilterKey = JSON.stringify(filters);

  // ── Preflight: fire immediately (0ms) ──────────────────────────────────
  preflightRef.current?.abort.abort();
  const pfAbort = new AbortController();
  preflightRef.current = { abort: pfAbort, filterKey: currentFilterKey };

  apiFetch(`/api/files/${fileId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters, sort, offset: 0, limit: 0, mode: 'preflight' }),
    signal: pfAbort.signal,
  })
    .then((res) => res.body ? streamArrowFrames(res.body) : null)
    .then(async (frames) => {
      if (!frames) return;
      for await (const { table } of frames) {
        if (!table) continue;
        // Preflight returns god query at index 0 (only frame)
        // But now viewport is index 0 in full queries — for preflight mode,
        // there's only 1 table and it's always the god query.
        const god = parseGodTable(table);
        // Only promote if filterKey hasn't changed since we fired
        if (preflightRef.current?.filterKey === currentFilterKey) {
          dispatch({ type: 'QUERY_DATA', payload: { count: god.filteredCount, stats: god.constrainedStats } });
        }
      }
    })
    .catch(() => {}); // Aborted or failed — silently ignore

  // ── Full query: 80ms debounce (unchanged) ──────────────────────────────
  const timer = setTimeout(() => {
    // ... existing full query logic, unchanged
    // Cancel preflight if still in-flight (full query will provide everything)
    preflightRef.current?.abort.abort();
    preflightRef.current = null;
    // ... rest of existing code
  }, 80);

  return () => {
    clearTimeout(timer);
    preflightRef.current?.abort.abort();
    preflightRef.current = null;
  };
}, [fileId, state.phase, filterKey, sortKey]);
```

Note: The preflight server response uses `numTables = 1` and the single frame is always the god query. The client reads `streamArrowFrames` which yields `{ index: 0, table }` — since there's only one frame and it's the god query, we call `parseGodTable` directly regardless of index.

**Step 4: Rebuild and verify**

Run: `npm run build -w packages/server`
Run: `npm run build -w packages/client`
Run: `npx tsc --noEmit -p packages/client/tsconfig.json`

**Step 5: Commit**

```bash
git add packages/client/src/lib/SpeculativeQuery.ts packages/client/src/hooks/useFileQuery.ts packages/server/src/routes/query.ts
git commit -m "perf: basin speculative preflight — count+stats before debounce"
```

---

## Verification

**Pattern A (frame reorder):** Open DevTools Network tab. Apply a filter. Inspect the Arrow IPC response timing — the first frame should be viewport rows (~100ms), second frame should be god query (longer). Table rows should appear before the count badge updates.

**Pattern D (render separation):** Open React DevTools Profiler. Apply a filter. When the god frame arrives (count update), verify ControlCenter does NOT re-render. Only the RiverGauge/count badge should update. Each histogram frame should re-render exactly one RangeSliderCard.

**Pattern B (preflight):** Apply a filter. In the Network tab, verify TWO requests fire: a preflight (immediate, `mode: 'preflight'`) and the full query (80ms later). The count badge should update from the preflight before the full query completes. Rapid filter changes: verify preflight requests are aborted cleanly (no console errors).

**Integration:** All three patterns compose. Frame reorder means viewport rows stream first. Render separation means those rows update VirtualRows without touching the sidebar. Preflight means count + stats update before the full query fires. The user sees: rows (~100ms) → count + stats (~80ms later from preflight) → histograms (when full query completes). Total perceived latency for rows: ~100ms instead of ~2-3s.

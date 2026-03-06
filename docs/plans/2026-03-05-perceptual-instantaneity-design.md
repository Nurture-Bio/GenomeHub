# Perceptual Instantaneity — Four Patterns to Eliminate Perceived Latency

## Problem

Filter → table update takes 2-3s (80ms debounce + server round-trip). The user perceives a loading state for the entire duration. The stale-while-revalidate pattern preserves old data during queries, and the breathing grace period (300ms) hides fast queries — but the fundamental latency from filter change to rows-on-screen remains.

## Architecture Baseline

All DuckDB computation is server-side (`POST /api/files/:id/query`). The client has no local query engine. Arrow IPC frames stream back: god (count + stats) → viewport (rows) → histograms (per-column). The client decodes frames incrementally via `streamArrowFrames` async generator.

Filter convergence: all filter types (range, category, text) converge into `specs: FilterSpec[]` → `filterKey = JSON.stringify(specs)` → Basin effect (80ms debounce) → `serverQuery()`.

## Patterns

### A. Streaming Frame Priority Inversion

**Current order:** god → viewport → histograms
**New order:** viewport → god → histograms

The god query (`COUNT(*) + MIN/MAX`) requires a full Parquet scan. The viewport query (`SELECT * WHERE ... LIMIT 50`) stops at the first qualifying row group. Emitting viewport first means rows appear in ~100ms while aggregation computes in the background.

**Server change only.** Client's `streamArrowFrames` identifies frames by schema, not position. Reorder the DuckDB queries in the route handler. The `onGod`/`onViewport` callbacks in `useFileQuery.ts` already fire on frame arrival — they'll fire in the new order automatically.

**Files:**
- `packages/server/src/routes/files.ts` (or wherever the `/query` route handler lives) — reorder DuckDB query execution: viewport LIMIT query first, then god aggregation, then histogram queries

**Risk:** The count badge shows stale count until the god frame arrives. This is already the behavior today (stale-while-revalidate preserves old `snapshot.count`). No regression.

---

### B. Basin Speculative Preflight

Fire a lightweight query *immediately* when `filterKey` changes (0ms delay), requesting only count + constrained stats (no viewport rows, no histograms). The 80ms-debounced full query still fires on schedule. On arrival:

- If `filterKey` hasn't changed since the preflight fired → promote the preflight result into the snapshot. The full query still fires but the user already sees the count + stats.
- If `filterKey` changed → abort the preflight. The full query uses fresh params.

**Interface:**
```typescript
// packages/client/src/lib/SpeculativeQuery.ts
export interface SpeculativeQuery<TParams, TOutput> {
  /** Fire a lightweight speculative query. Caller manages abort. */
  fire(params: TParams, signal: AbortSignal): Promise<TOutput>;
  /** Can the preflight result be promoted to the real snapshot? */
  canPromote(preflightParams: TParams, commitParams: TParams): boolean;
}
```

**Implementation:** In the Basin effect (`useFileQuery.ts`), add a `preflightRef` that fires immediately on `filterKey` change. The preflight hits a lighter server endpoint (or the same endpoint with `limit: 0` to skip viewport rows). The 80ms timer fires the full query as before. Before dispatching `START_QUERY`, check `canPromote()` — if the preflight already returned and params match, merge its count/stats into the snapshot.

**Files:**
- `packages/client/src/lib/SpeculativeQuery.ts` — interface definition
- `packages/client/src/hooks/useFileQuery.ts` — Basin effect modification, `preflightRef`
- Server route — support a lightweight query mode (count + stats only, no viewport/histograms)

**Expected gain:** God frame data arrives ~80ms earlier. Combined with Pattern A (viewport first), the user sees rows AND count before the full query would have even fired under the current architecture.

---

### C. Scroll Prefetch with Directional Momentum

Track scroll velocity and direction. Prefetch 1-2 windows ahead of the viewport in the scroll direction. The LRU cache (10 tables, 200 rows each) already has capacity for speculative windows.

**Eager window-0 priming:** When a filter commits and `cacheGen` bumps, immediately request window 0 (the first page) before the virtualizer's scroll effect runs. Today, the first fetch fires only after VirtualRows renders and the scroll effect triggers — adding one render cycle of skeleton display.

**Files:**
- `QueryWorkbench.tsx` VirtualRows component — add `scrollVelocityRef` storing `Δindex / Δtime`, modify fetch effect to compute `predictedEnd = end + velocity * 500ms`, fetch windows covering `[start, predictedEnd]`
- `useFileQuery.ts` — after `onViewport` callback fires (first Arrow table cached), consider priming adjacent windows

**Expected gain:** Consecutive scroll stops hit warm cache. Skeleton-to-data transition after filter change is one frame faster.

---

### D. Render Phase Separation

Split `deriveViewState` into two memos with different dependency sets:

1. **Structural memo** — deps: `[phase, isQuerying, error]` — derives `showSkeleton`, `flowState`, `convergenceStep`. Changes few times per query cycle.
2. **Data memo** — deps: `[snapshot.stats, snapshot.histograms, snapshot.count]` — derives count badge value, constrainedStats, constrainedHistograms. Changes when Arrow frames arrive.

Extract each filter card into a standalone memoized component:
```typescript
const RangeSliderCard = React.memo(function RangeSliderCard({
  column, stats, histogram, pending, ...
}: RangeSliderCardProps) { ... });
```

When `snapshot.histograms` updates, only the card whose histogram reference actually changed re-renders — not all 20+ cards.

**Files:**
- `packages/client/src/components/QueryWorkbench.tsx` — split `deriveViewState` into two memos, extract `RangeSliderCard`
- `packages/client/src/components/ControlCenter.tsx` (if extracted) — receive granular props

**Expected gain:** God frame arrival (count update) stops cascading into 20+ slider re-renders. Each histogram frame re-renders only its own card. Sidebar render cost drops from O(columns) to O(1) per frame.

---

## Implementation Order

```
A (frame reorder) → D (render separation) → B (preflight) → C (scroll prefetch)
```

**A first:** Biggest bang for least code. Server-only change. Rows appear 1-2s earlier.
**D second:** Eliminates wasted re-renders that would amplify A's benefit. When frames arrive in the new order (viewport first), the render separation ensures each frame only updates the components it affects.
**B third:** Layers speculative preflight on top of the reordered frames. The preflight's count/stats arrive before the full query's viewport frame — user sees count updating while rows stream in.
**C last:** Polishes scroll experience. Depends on the cache infrastructure that A and B exercise heavily.

## Verification

**Pattern A:** Apply a filter. Verify rows appear before the count badge updates. Network tab: first Arrow frame should be the viewport (50 rows), not the god query.

**Pattern B:** Apply a filter. Verify count badge updates before the 80ms debounce would have fired the full query. Check that rapid filter changes (drag quickly) abort stale preflights.

**Pattern C:** After applying a filter, scroll down steadily. Verify no skeleton placeholders appear at the leading edge of the scroll direction. Check LRU eviction: scroll far, scroll back — cold windows should show skeletons, warm windows should not.

**Pattern D:** Open React DevTools Profiler. Apply a filter. Verify that the god frame arrival (count update) does NOT cause ControlCenter or RangeSlider re-renders. Only the count badge component should re-render. Each histogram frame should re-render exactly one RangeSliderCard.

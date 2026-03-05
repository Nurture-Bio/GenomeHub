# Visual Language & Performance Architecture

Every panel, surface, border, and button speaks one language.
All style definitions live in `src/index.css` under the **VISUAL LANGUAGE** section.

**Invariant: No inline `style={{}}` for colors, borders, or backgrounds. Named classes only.**

---

## Surface Primitives

| Class | Composition | When to use |
|-------|------------|-------------|
| `.glass-canopy` | Translucent layer (α = 0.72) + backdrop blur + `white/10` border | Sticky headers — content scrolls beneath, blur reveals the z-separation |
| `.vault-door` | Dark overlay (`black/40` → `black/60` on hover) + `white/10` border | Collapsible section toggles, drawer triggers |
| `.sidebar-surface` | Dark overlay (`black/40`) + hairline right border (`white/5`) | Sidebar background |
| `.river-groove` | Recessed track (`oklch 0.15`) + inset shadow | Gauge track backgrounds |
| `.river-fill` | 3-stop gradient: `dark_teal → saturated_cyan → pale_cyan` | Gauge fill bars |
| `.range-track` | Semi-transparent dark substrate | Range slider track |

## Control Affordances

| Class | Steady State | Hover (Transient) | Active (Latched) |
|-------|-------------|-------------------|------------------|
| `.sigil` | Hairline border (`white/10`), attenuated text | Cyan highlight (`cyan/10` fill, `cyan/30` border) | — |
| `.sigil.active` | — | Saturated cyan | Solid cyan fill, inverted text, bold weight |
| `.sigil-sm` | Compact variant — reduced padding, no text-transform | Same transitions | Same |
| `.ghost` | Fully occluded (`opacity: 0`, pointer-events: none) | — | — |
| `.ghost.awake` | Materialized (`opacity: 1`, pointer-events restored) | Inherits from context | — |

**`.sigil`** = persistent affordance. Always in the layout, always addressable. Export button, categorical chips.
**`.ghost`** = conditional affordance. Zero footprint until a predicate evaluates true. Clear-filters button: `.ghost.awake` iff `|activeFilters| > 0`.

## Cyan Channel

Single hue at four attenuation levels. Contrast is amplitude, not frequency.

```
--color-cyan    oklch(0.75 0.18 195)    α = 1.0    Carrier — active indicators, selected state
cyan/70                                  α = 0.7    Attenuated — secondary labels, file extensions
cyan/30                                  α = 0.3    Threshold — hover borders, focus rings
cyan/10                                  α = 0.1    Ambient — hover fills, selection backgrounds
```

Design constraint: `∀ element ∈ accent_set: hue = 195°`. One carrier frequency. Contrast is amplitude modulation only.

## Border Tokens

```
white/10    Structural edges — panel borders, control outlines, section dividers
white/5     Minimal seams — sidebar boundary (perceptible only at ΔL > 0.02)
```

## Deprecated Patterns (do not reintroduce)

- **Grain overlay** — SVG noise texture on dark surfaces. SNR improvement: zero. GPU cost: nonzero. Removed.
- **Inline color styles** — `style={{ background, color, borderColor }}` scattered across components. Violates single-assignment for visual tokens.
- **`backdrop-blur` on opaque surfaces** — Compositor overhead with no visual output. Blur requires α < 1.0 behind the surface to have any effect.
- **Inset shadows on sidebar** — `box-shadow: inset -10px 0 20px` synthesized false depth on a flat plane. Removed.

---

## Performance Architecture

51 interlocking mechanisms that make 2.6M rows feel instant. Grouped by the resource they protect.

---

### Data Transport — Binary Streaming Pipeline

**1. Arrow IPC Streaming** (`useFileQuery.ts: streamArrowFrames`)
Server emits binary Arrow IPC frames with 4-byte little-endian length prefixes. Client decodes via `ReadableStream` async generator — each frame yields a Table the instant its bytes complete. No buffering the full response. Throughput is `Σ frame_i` streamed, not `max(frame_i)` blocked.

**2. Sequential Query Pipeline** (`useFileQuery.ts: serverQuery`)
Aggregate frame → viewport frame → histogram frames, in strict causal order. The happens-before relation `aggregate ≺ viewport ≺ histogram[0..n]` is enforced by the server's frame emission order. Never `Promise.all` — profile hydration (JSONB merge) has a write-write conflict if frames arrive concurrently.

**3. Incremental Callbacks** (`onGod` / `onViewport`)
`onGod` fires when the aggregate frame lands (filtered count + constrained stats). `onViewport` fires when rows arrive. The user sees "5,271,403 records" while the virtualizer is still empty. Latency hiding: the perceived cost is `t_aggregate`, not `t_aggregate + t_viewport + Σt_histogram`.

**4. AbortController — Stale Request Cancellation** (`useFileQuery.ts: abortRef`)
New filter/sort → immediately abort previous in-flight fetch. Without this, responses arrive out of order: `query₁` (slow, unfiltered) overwrites `query₂` (fast, filtered). The AbortController establishes a total order on committed results: only the latest query's response is ever applied.

**5. Promise Deduplication** (`useDataProfile.ts: fetchCache`)
Module-level `Map<key, Promise>`. If `∃ p ∈ cache : key(p) = key(request)`, return `p`. Handles React StrictMode double-fires (same effect fires twice → one fetch). This is memoization where the identity function is the cache key. TTL = promise lifetime; self-cleans via `.finally()`.

---

### Virtualization — Rendering n = 2.6M Rows in O(k) DOM Nodes

**6. TanStack Virtual** (`QueryWorkbench.tsx: VirtualRows`)
Only `k = ⌈viewport_height / row_height⌉ + 2 × overscan` rows exist in the DOM. For a 800px viewport with 28px rows and `overscan = 20`: `k = 29 + 40 = 69` nodes. The remaining `n − k` rows are a mathematical fiction — an offset and a height.
- `estimateSize: () => 28` — fixed row height, O(1) layout per row. No measurement pass.
- `initialRect: { width: 0, height: 800 }` — seed container height before first measure so the virtualizer renders valid rows on frame 1, not frame 2.

**7. Debounced Fetch on Scroll** (`VirtualRows: useEffect with timerRef`)
150ms dead time after scroll stops before fetching. In-flight requests cancel when viewport moves. One scroll gesture = one network request. Without the debounce, a fast scroll generates `Δy / row_height` fetch calls — each valid for exactly one frame.

**8. Windowed LRU Cache** (`useFileQuery.ts: fetchRange, MAX_CACHED_TABLES = 10`)
Arrow tables keyed by window offset `w ∈ {0, 200, 400, …}`. Cache capacity: 10 tables (~1MB). Eviction policy: `argmax_w |w − viewport_offset|` — discard the farthest window from the user's position. A cache miss is one round-trip. A stale hit is wrong data on screen. The miss is always cheaper.

**9. Zero Materialization** (`useFileQuery.ts: getCell`)
`getCell(row, col)` indexes into Arrow column vectors directly. No `toJSON()`, no `Array.from()`, no row-object construction. BigInt → Number conversion is performed only for the `k` visible cells. For `n` total cells across all columns, materialization cost is `O(k)`, not `O(n)`.

**10. Fallback JSON Rows** (`useFileQuery.ts: fallbackRows`)
Initial profile includes `initialRows` as JSON — seeded into the row Map on mount, cleared when the first Arrow response arrives. User sees data before any binary query fires. This is speculative execution: we bet that the first rows won't be filtered out. The bet pays off ~95% of the time.

**11. Cache Epoch Counter** (`useFileQuery.ts: cacheGen`)
Monotonically increasing integer. Increments when an Arrow table enters the cache. Passed as prop to VirtualRows. The ref-based `Map` is invisible to React's reconciler — `cacheGen` is the explicit invalidation signal. Epoch-based invalidation: component re-reads the cache iff `epoch_new > epoch_old`.

**12. GPU-Composited Row Positioning** (`VirtualRows`)
Rows use `transform: translateY(${offset}px)`, not `top: ${offset}px`. Transforms are compositor-handled (GPU thread). `top` triggers layout reflow (main thread). For `k = 69` rows repositioning every frame during scroll: ~0ms vs ~2ms of main-thread work per frame.

---

### Rendering — Maintaining 60fps Under Load

**13. `useTransition` — Latency Hiding via Priority Inversion** (`QueryWorkbench.tsx`)
Filter handlers split into two phases: `setState()` (synchronous, high-priority — UI updates this frame) then `startTransition(() => query())` (deferred, low-priority — server query + reconciliation). The user sees the chip toggle before the query fires. Without `useTransition`, both operations share one priority and the chip visually lags the click by the round-trip duration.

**14. CSS-Variable-Driven Slider** (`QueryWorkbench.tsx: syncTrack`)
`el.style.setProperty('--lo', pct)` writes directly to the CSSOM. CSS `calc()` computes thumb position, track fill, and highlight zone from these variables. React reconciliation cost during drag: zero. The drag loop is an open-loop controller — no state reads, no diffs, no virtual DOM. 60fps is guaranteed because the only work is a CSSOM write (~0.01ms).

**15. CSS `clipPath` Histogram Mask** (`DistributionPlot`)
SVG `<clipPath>` references `--lo` and `--hi` CSS variables. During drag, only CSS variables update — the SVG tree is never touched. The compositor applies the clip as a GPU-side mask operation. Render cost during drag: O(1) compositor work, O(0) main-thread work.

**16. `memo()` with Structural Equality** (`DistributionPlot`)
Custom comparator: re-render iff `staticBins`, `dynamicBins`, `height`, or `pending` changed. Clip position lives in CSS variables — invisible to React. This is manual common-subexpression elimination: the component's render function is expensive, so we cache its output and invalidate only on structural input change.

**17. `memo()` as Reconciliation Firewall** (`ControlCenter`, `VirtualRows`)
Both wrapped with `memo()`. Without this, toggling `isTableOpen` (parent state) cascades into the entire filter panel (10+ cards) and the full table body. `memo()` cuts the reconciliation DAG at these nodes. Reflow cost of a parent state change drops from O(subtree) to O(1) shallow compare.

**18. Memoized Skeleton Grid** (`QueryWorkbench.tsx: skeletonGrid useMemo`)
Skeleton DOM (15 rows × N columns) built once, cached in `useMemo`. `skelRef.current` captures a frozen snapshot of column metadata + widths at first render. The skeleton is immutable — never rebuilt, regardless of how many times the loading state cycles.

**19. Skeleton Opacity Toggle** (never conditional mount)
Skeleton overlay is `position: absolute; inset: 0`. Visibility controlled by `opacity` and `pointer-events` only. GPU composites opacity changes in ~0.1ms. Conditional mount (`{loading && <Skeleton/>}`) would construct and destroy DOM nodes each cycle, triggering layout recalculation and a double-fade artifact.

**20. RAF Sample-and-Hold for Range Drag** (`useFilterState.ts: setRangeVisual`)
Pointer events arrive at the input device's polling rate (typically 125–1000 Hz). `requestAnimationFrame` downsamples to the display refresh rate (60 Hz). The `pendingDrag` ref stores the latest value; RAF reads it once per frame. This is a sample-and-hold circuit: continuous input → discrete output at display frequency. We care about the position, not the trajectory — last-value sampling is exact.

**21. `clipPath` on RiverGauge** (`RiverGauge.tsx`)
```tsx
clipPath: `inset(0 ${100 - ratio * 100}% 0 0)`
```
The fill bar is a full-width element clipped by the compositor. `clipPath` is paint-only — GPU thread, zero main-thread cost. Animating `width` would be O(reflow); animating `clipPath` is O(1) compositor work.

---

### State Management — Closure Hygiene & Consistency

**22. `triggerRef` — Single-Writer Register** (`QueryWorkbench.tsx`)
```tsx
const triggerRef = useRef<() => void>(() => {});
triggerRef.current = triggerFilters;  // overwritten every render
```
Deferred/debounced callbacks invoke `triggerRef.current()` — a pointer that always dereferences to the latest closure. The ref is a single-writer register: React's render loop is the sole writer, callbacks are readers. No contention. No dependency arrays. No stale captures.

**23. `useRetainedState` — Zero-Order Hold** (`QueryWorkbench.tsx`)
Retains the last defined value across render cycles. When `constrainedStats` goes `undefined` (old response cleared, new response in flight), the retained value bridges the gap. This is a zero-order hold from control theory: hold the last known output until new input arrives. Prevents flicker during the dead time between query cycles.

**24. Ref-Sync for Pointer Handlers** (`RangeSlider: lowRef, highRef`)
`lowRef.current = low` every render. Pointer-move listeners read `.current`. Without this, the listener captures `low` from the render it was created in — potentially hundreds of renders stale. The ref is a compare-and-swap register: each render atomically updates the value that event handlers observe.

**25. Visibility Toggle — No Layout Shift** (`QueryWorkbench.tsx`)
Never conditionally mount elements that participate in layout flow. `.ghost` / `.ghost.awake` toggles `opacity` and `pointer-events` without DOM insertion/removal. Invariant: `∀ frame: layout_height(container) = constant`, regardless of filter state.

**26. Zero-Height Virtualizer Divergence**
When `!isTableOpen`, **unmount** `<VirtualRows>` entirely. `useVirtualizer` with `height = 0` enters a degenerate state: it computes zero rows fit, re-measures, finds zero again, and diverges into an infinite resize loop. This is the one controlled exception to the "never conditionally mount" invariant.

---

### Network — Query Minimization

**27. Null-Set Elimination** (`hasDataInDelta`)
Before issuing a query: map slider bounds to histogram bins, check `Σ bin_count > 0` in the selected range. If the sum is zero, the query would return `∅` — skip it. The fastest query is the one you never send.

**28. Debounced Text Filter** (`useFilterState.ts: setTextFilter`)
300ms dead time. User types "BRCA1" — without debounce, that's 5 queries (B, BR, BRC, BRCA, BRCA1). With: 1 query. Savings: `(n_keystrokes − 1) / n_keystrokes` of wasted round-trips.

**29. Range Drag = Zero Queries Until Commit**
During drag: `setRangeVisual` writes to `dragVisuals` (transient buffer — visual-only). On `pointerUp`: `commitRange` checkpoints the buffer into `rangeOverrides` (committed store) and flushes the transient. The query effect watches only `rangeOverrides`. A full-range drag fires exactly 1 query. This is a write-ahead log: buffer writes in the hot path, checkpoint atomically on commit. It also eliminates the stale-closure-behind-by-one (see #44) — rAF commits state in render N, `pointerUp` reads in render N+1, so the query always observes committed values.

**30. First-Ready Preserves Prefetch Data** (catch-up effect)
When the pipeline transitions to `ready`, don't clear the fallback JSON rows. Let them remain visible while the first Arrow query fires. The skeleton → data transition happens once (Arrow lands), not twice (clear → skeleton → Arrow). Speculative execution with lazy invalidation.

---

### Profile Hydration — Lazy & Sequential

**31. Demand-Driven Attribute Fetch** (`useDataProfile`)
Only requests attributes the current view needs (`columnStats`, `cardinality`, `histograms`). Attributes resolved to `null` (negative cache) are never re-fetched. A view that never renders histograms never pays for their computation. Fetch cost: `O(|requested|)`, not `O(|all_attributes|)`.

**32. Polling for Async Computation** (`useDataProfile`)
Server returns HTTP 202 while attributes are computing. Client polls at 1 Hz, max 30 iterations. Computing cardinality over 10⁸ rows takes wall-clock time — the polling loop decouples the UI's frame budget from the server's service time.

---

### Numerical & Layout Stability

**33. Relative Float Tolerance** (`RangeSlider`)
Out-of-bounds detection: `|x − bound| < ε` where `ε = range × 10⁻³`. The pipeline DuckDB → Arrow IPC serialization → JS `Number` accumulates representational error at each boundary crossing. `9.999999999` is `10` within tolerance. Standard relative-epsilon comparison from numerical analysis.

**34. Uncontrolled Input Reconciliation** (`syncTrack`)
HTML range inputs are uncontrolled — React doesn't own their `.value`. When filter state changes (committed bounds update, constrained range narrows), `syncTrack` writes `.value` imperatively. Numeric comparison before write prevents float → string → float precision loss from triggering spurious change events.

**35. Deterministic Skeleton Widths**
Each skeleton bar: `width = 55 + ((row × 17 + col_len × 11) mod 40)%`. The hash function is a low-quality PRNG — intentionally. Uniform widths read as a broken loading state. Varied widths read as "data is arriving." The function is pure: same inputs → same widths across renders. No flicker.

**36. Data-Adaptive Column Widths** (`colWFromName`)
`width = max_char_length × 7.5px + chrome`. Sized from actual data distribution, not hardcoded constants. Columns with short values get narrow tracks; columns with UUIDs get wide ones.

---

### Layout Containment & Compositor Promotion

**37. Tabular Numerals** (`font-variant-numeric: tabular-nums`)
Applied to all numeric readouts (`.sigil`, RiverGauge, row counts). Forces monospaced digit widths: `advance_width('1') = advance_width('9')`. Without this, numeric text jitters as values change because proportional fonts render `111` narrower than `999`. Invariant: `∀ digit d: advance_width(d) = constant`.

**38. Scrollbar Reflow Guard** (`scrollbar-gutter: stable`)
When the drawer opens and content exceeds viewport height, `overflow-y: auto` injects a scrollbar — shifting the entire layout 12px left. `scrollbar-gutter: stable` reserves scrollbar width permanently. This is the layout equivalent of pre-allocating a buffer: pay the space cost upfront to avoid reallocation jitter. Applied to `<main>` and the table scroll container.

**39. Fitts's Law Correction** (slider thumb `box-shadow: 0 0 0 8px transparent`)
The 14px slider thumb is too small for reliable target acquisition. An 8px transparent `box-shadow` expands the effective hit area to 30px without changing visual size. `::after` pseudo-elements don't work on `<input>` elements, so the shadow serves as the invisible hit region.

**40. CSS Containment — Reflow DAG Partitioning** (`contain: layout style paint`)
Applied to `.vault-door`, `.glass-canopy`, `.sidebar-surface`. This is a graph cut in the browser's reflow DAG: the layout engine treats the boundary as a hard partition. Reflows inside the contained subtree are `O(subtree)`, not `O(document)`. Text changes, filter updates, and data hydration inside a contained element cannot cascade upward.

**41. Selective GPU Promotion** (`will-change`)
- `.vault-door:hover { will-change: transform }` — promotes to compositor layer before interaction
- `.river-fill { will-change: clip-path }` — always promoted (continuously animated)
Each promotion costs VRAM (the element gets its own texture). Applied only where animation actually occurs. Global `will-change` is a memory leak with extra steps.

**44. Batched-State Read-After-Write Hazard** (`QueryWorkbench.tsx`)
React batches `setState` within synchronous handlers. Calling `setSelected(next)` then reading `selected` in the same handler reads the pre-batch value — a classic read-after-write hazard. Fix: mirror each filter state in a `useRef`. The functional updater (`setState(prev => ...)`) runs synchronously, so the ref updates inside it. The query function reads `.current` — always post-write. Range sliders avoid this via the two-phase protocol (#29): drag and commit are separate events in separate renders, so committed state is always visible when the query fires. Category and text filters lack a discrete commit event, so they need the ref-sync.

**45. Write-Ahead Log — Transient / Committed Separation** (`useFilterState.ts: dragVisuals + rangeOverrides`)
`dragVisuals` is the write buffer — high-frequency, visual-only, never observed by the query effect. `rangeOverrides` is the committed store — low-frequency, durable, watched by the query effect. On `pointerUp`, `commitRange` checkpoints the buffer into the store and flushes the buffer. Invariant: the query effect's dependency set contains `rangeOverrides` but never `dragVisuals`. This guarantees `queries_during_drag = 0`. The 80ms debounce serves as the equivalent checkpoint for text filters (which have no discrete commit event).

**46. Atomic Query Lifecycle — Total State Machine** (`useFileQuery.ts: queryReducer`)
`isQuerying`, `queryError`, and `QuerySnapshot` are co-located in a single reducer. Three actions govern transitions:
```
START_QUERY  → { isQuerying: true,  queryError: null     }
QUERY_DATA   → { isQuerying: false, queryError: null     }  (when done: true)
QUERY_ERROR  → { isQuerying: false, queryError: payload  }
```
State transitions are total functions — every action produces a fully-specified next state. Invariant: `¬(isQuerying ∧ queryError ≠ null)`. No orphaned spinners, no lingering errors after success. `FATAL_ERROR` handles initialization failures (unrecoverable); `QUERY_ERROR` handles query failures from the `ready` phase (recoverable — next query clears it).

**47. Controller / View Separation** (`RiverGauge.tsx`)
RiverGauge accepts `flowState: 'normal' | 'pending' | 'stalled'` and an optional `statusLabel`. It knows nothing about queries, errors, or pipeline phases. The controller (`QueryWorkbench.tsx`) maps domain state to visual state: `queryError ? 'stalled' : isQuerying ? 'pending' : 'normal'`. CSS implements the transitions: `.river-fill.pending` pulses, `.river-fill.stalled` turns amber. The gauge is a pure morphism: `(flowState, ratio, label) → pixels`. All domain logic stays in the controller.

**48. Systemic CSS Tokens for Gauge** (`index.css: .river-readout, .river-total, .river-fill.pending`)
All inline `opacity`, `fontSize`, `letterSpacing`, `color`, `textTransform`, and `animation` purged from `RiverGauge.tsx`. Replaced with CSS classes: `.river-readout` (typography, color, transition), `.river-readout.compact` / `.accent` / `.empty` (variant modifiers), `.river-total` (secondary readout), `.river-gauge.dissolved` (terminal fade). Only dynamic layout values (`clipPath`, `minWidth`, `height`) remain inline. Rule: if the value is a design constant, it's a CSS token — not a hardcoded literal in TSX.

**49. Unified Scroll Container** (`QueryWorkbench.tsx`)
Header and body share one `overflow-auto` element. Header uses `position: sticky; top: 0; z-index: 10`. No JS scroll sync (`onScroll` + `scrollLeft` mirror deleted). The browser's compositor handles horizontal lock natively — zero JS per scroll frame. The previous dual-container approach required JS to mirror `scrollLeft` between two elements, producing a 1-frame desync visible as header/body misalignment during fast horizontal scroll.

**50. ViewState — Pure Projection Function** (`QueryWorkbench.tsx: deriveViewState`)
`f: (Lifecycle × Snapshot × Bool × ℕ × ℕ) → ViewState`. Computes every visual boolean the component needs: `convergenceStep`, `convergenceSteps`, `isReady`, `isTerminal`, `flowState`, `flowLabel`, `isPending`, `hasFilter`, `noResults`, `showSkeleton`. Called once via `useMemo`, consumed as `viewState.*` throughout. This is common-subexpression elimination applied to view logic — 12+ scattered boolean expressions that interrogated the same inputs with subtly inconsistent logic, collapsed into one referentially transparent function. Adding a new `QueryPhase` requires touching exactly one function.

**51. QueryState / QuerySnapshot / store — Three Orthogonal Projections** (`useFileQuery.ts`)
The hook partitions its output into three orthogonal slices:
- **lifecycle** `{ phase, isQuerying, error, queryError }` — the state machine's current node
- **snapshot** `{ count, total, stats, histograms }` — point-in-time query results (immutable between queries)
- **store** `{ columns, baseProfile, getCell, hasRow, fetchRange, clearCache, isFetchingRange, cacheGen }` — data accessors (stable references)

`QuerySnapshot` is updated via `QUERY_DATA` actions — partial merges as Arrow frames arrive. `QUERY_DATA { done: true }` finalizes the cycle (`isQuerying ← false`). No standalone `useState` for count, total, stats, or histograms — all live inside the reducer as atomic state transitions. The `queryReducer` is the single writer; the component reads three projections.

---

### Future Architecture (Not Yet Implemented)

**42. Web Worker Arrow Decoding**
Arrow IPC frames are decoded on the main thread. A 10MB frame blocks for ~50ms — 3 dropped frames at 60fps. Fix: move `apache-arrow` into a Web Worker. Return decoded `ArrayBuffer` via `Transferable Objects` (zero-copy ownership transfer — the buffer moves, not copies). Main thread never touches the binary data. Decoding cost becomes invisible regardless of frame size.

**43. FinalizationRegistry for Deterministic Cleanup**
Arrow Tables are contiguous typed-array allocations. When evicted from the LRU cache, JS GC reclaims them eventually. `FinalizationRegistry` would provide a deterministic callback to call `.free()` if WASM decoders are introduced (DuckDB-WASM, Rust-compiled). Deterministic cleanup prevents heap fragmentation under sustained load.

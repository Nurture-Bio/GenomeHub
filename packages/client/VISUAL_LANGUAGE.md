# The Console — Visual Language & Performance Architecture

Every panel, surface, border, and button on this site speaks one language.
All style definitions live in `src/index.css` under the **VISUAL LANGUAGE** section.

**Rule: No inline `style={{}}` for colors, borders, or backgrounds. Use named classes.**

---

## Materials

| Class | What it looks like | When to use |
|-------|-------------------|-------------|
| `.glass-canopy` | Frosted void (85% opacity) + blur + `white/10` border | Sticky header panels that content scrolls behind |
| `.vault-door` | Dark glass (`black/40` → `black/60` on hover) + `white/10` border | Clickable drawer toggles, collapsible sections |
| `.sidebar-surface` | Dark glass (`black/40`) + whisper-quiet right seam (`white/5`) | Sidebar background |
| `.river-groove` | Deep inset track (`oklch 0.15`) + inner shadow | Progress bar / gauge backgrounds |
| `.river-fill` | 3-stop cyan gradient (dark teal → electric → pale) | Progress bar fills |
| `.range-track` | Semi-transparent dark void | Range slider track backgrounds |

## Controls

| Class | Resting | Hover | Active/Pressed |
|-------|---------|-------|----------------|
| `.sigil` | Etched border (`white/10`), muted text | Cyan glow (`cyan/10` bg, `cyan/30` border) | — |
| `.sigil.active` | — | Brighter cyan | Solid cyan bg, void text, bold |
| `.sigil-sm` | Same as sigil but compact padding, no uppercase | Same | Same |
| `.ghost` | Invisible (`opacity: 0`, no pointer events) | — | — |
| `.ghost.awake` | Fades in (`opacity: 1`, pointer events restored) | Inherits from other classes | — |

**Sigil** = always visible, etched into the surface, glows when touched (Export button, categorical chips).
**Ghost** = invisible until summoned, fades in when needed (Clear Filters).

## Cyan Spectrum

```
--color-cyan         oklch(0.75 0.18 195)    Full — active text, indicators
cyan/70                                       Muted — file extensions, ghost labels
cyan/30                                       Whisper — hover borders
cyan/10                                       Breath — hover backgrounds
```

## Borders

```
white/10    Panel edges (canopy, vault door, sidebar dividers, sigil borders)
white/5     Sidebar right seam (barely visible against main content)
```

## Killed Patterns (never resurrect)

- **Grain overlay** — White noise SVG texture that lightened every dark surface. Exterminated.
- **Inline color styles** — `style={{ background, color, borderColor }}` scattered across components. Migrate to named classes.
- **backdrop-blur on opaque surfaces** — Wasted GPU cycles blurring nothing. Only use when content actually scrolls behind.
- **Inset shadows on sidebar** — `box-shadow: inset -10px 0 20px` created fake depth on a flat wall. Gone.

---

## Performance Architecture

30+ interlocking tricks that make 2.6M rows feel instant. Grouped by what they protect.

---

### Data Transport — Zero-Copy Binary Pipeline

**1. Arrow IPC Streaming** (`useParquetPreview.ts: streamArrowFrames`)
Server sends binary Arrow IPC frames with 4-byte LE length prefixes. Client decodes frames incrementally via `ReadableStream` async generator. Tables are yielded the instant their bytes complete — no buffering the full response.

**2. Sequential Query Pipeline** (`useParquetPreview.ts: serverQuery`)
God query → viewport → histograms, in strict order. Never `Promise.all`. Profile hydration (JSONB merge) races if queries run in parallel.

**3. Incremental Callbacks** (`onGod` / `onViewport`)
`onGod` fires when filtered count arrives. `onViewport` fires when rows land. User sees "5M records" before the virtualizer starts rendering rows. Perceived latency drops.

**4. AbortController — Stale Request Cancellation** (`useParquetPreview.ts: abortRef`)
New filter/sort fires → immediately abort previous in-flight request. Prevents older results from overwriting newer ones.

**5. Promise Deduplication** (`useDataProfile.ts: fetchCache`)
Module-level `Map<key, Promise>`. If two components request identical attributes for the same file (including React Strict Mode double-fires), returns the same Promise. Self-cleans via `.finally()`.

---

### Virtualization — Rendering 2.6M Rows

**6. TanStack Virtual** (`ParquetPreview.tsx: VirtualRows`)
- `overscan: 20` — 20 rows above/below viewport (560px buffer) prevents blank space during fast scroll
- `estimateSize: () => 28` — fixed row height, no measurement overhead
- `initialRect: { width: 0, height: 800 }` — guess at container height on Frame 1 so virtualizer renders sensible rows immediately

**7. Debounced Fetch on Scroll** (`VirtualRows: useEffect with timerRef`)
Waits 150ms after scroll stops before fetching missing windows. Cancels in-flight requests when viewport moves again. One scroll gesture = one fetch, not one fetch per pixel.

**8. Window-Based Cache** (`useParquetPreview.ts: fetchRange, MAX_CACHED_TABLES=10`)
Arrow tables keyed by window offset (0, 200, 400...). Max 10 tables (~1MB). Eviction: sort by distance to current viewport, delete farthest.

**9. Zero Materialization** (`useParquetPreview.ts: getCell`)
`getCell(index, colName)` reads Arrow vectors directly. No `arrowTableToRows()`. BigInt→Number conversion happens only for visible cells. 90% of data never converts.

**10. Fallback JSON Rows** (`useParquetPreview.ts: fallbackRows`)
Initial profile includes `initialRows` as JSON. Seeded into Map on mount. Cleared when first Arrow query lands. User sees data before any binary query fires.

**11. Cache Generation Bump** (`useParquetPreview.ts: cacheGen`)
Counter increments when Arrow table is added to cache. Passed as prop to VirtualRows. Ref-based Map doesn't trigger re-renders — cacheGen does.

**12. Transform translateY** (`VirtualRows`)
Rows positioned via `transform: translateY(Npx)` not `top: Npx`. Transform is GPU-composited; top triggers reflow.

---

### Rendering — 60fps Without Jank

**13. `useTransition` — Paint Before Math** (`ParquetPreview.tsx`)
All filter handlers: `setSelected()` paints the chip immediately. `startTransition(() => triggerRef.current())` defers the server query + tree reconciliation. The light turns on before the iron moves.

**14. CSS-Variable-Driven Slider** (`ParquetPreview.tsx: syncTrack`)
`el.style.setProperty('--lo', ...)` writes directly to DOM. CSS `calc()` drives thumb position, track fill, glow, void highlights. Zero React state for visual tweaks. 60fps drag with no reconciliation.

**15. CSS clipPath Histogram Mask** (`DistributionPlot`)
SVG `<clipPath>` uses inherited `--lo`, `--hi` CSS vars. When user drags, only CSS updates; SVG doesn't re-render. Browser GPU composites the masked histogram.

**16. `memo()` with Custom Comparator** (`DistributionPlot`)
Only re-renders if `staticBins`, `dynamicBins`, `height`, or `pending` change. Clip position (CSS var) never triggers re-render.

**17. `memo()` on Heavy Components** (`ControlCenter`, `VirtualRows`)
Both wrapped with `memo()`. Parent re-renders (e.g., `isTableOpen` toggle) don't cascade into 10+ filter cards or the entire table body.

**18. Memoized Skeleton JSX** (`ParquetPreview.tsx: skeletonGrid useMemo`)
Skeleton DOM (15 rows × N columns) built once and memoized. `skelRef.current` captures a frozen snapshot of columns + widths. Never rebuilds.

**19. Skeleton Opacity Transition** (not conditional mount)
Skeleton overlay is `position: absolute; inset: 0`. Only `opacity` + `pointerEvents` change. GPU composites opacity. Never conditionally mounted/unmounted — that causes double-fade.

**20. RAF Throttle for Slider Drag** (`handleRangeDrag`)
Rapid `onChange` events during drag stored in `pendingDrag` ref. One `requestAnimationFrame` batches them into a single `setState` per frame.

**21. `clipPath` for River Gauge** (`RiverGauge`)
```tsx
clipPath: `inset(0 ${100 - ratio * 100}% 0 0)`
```
GPU-composited bar animation. No width transitions that trigger reflow.

---

### State Management — No Stale Closures

**22. `triggerRef` Pattern** (`ParquetPreview.tsx`)
```tsx
const triggerRef = useRef<() => void>(() => {});
triggerRef.current = triggerFilters;  // Re-assigned every render
```
Debounced/deferred callbacks call `triggerRef.current()`. Always the latest version. No stale closures. No dependency arrays.

**23. `useRetainedState`** (`ParquetPreview.tsx`)
Keeps last non-undefined value in a ref. When `constrainedStats` goes undefined (old response cleared, new not arrived), retained value stays visible. No flicker.

**24. Ref-Based Sync for Event Handlers** (`RangeSlider: lowRef, highRef`)
`lowRef.current = low; highRef.current = high;` every render. Pointer-move listeners read `.current`. No stale captures.

**25. Ghost Button — No Layout Shift** (`ParquetPreview.tsx`)
Never conditionally mount/unmount elements that affect container height. `.ghost` / `.ghost.awake` toggles visibility without DOM insertion/removal.

**26. Zero-Height Virtualizer Trap**
When `!isTableOpen`, **unmount** `<VirtualRows>` entirely. `useVirtualizer` with `height: 0` burns CPU and triggers infinite resize loops. This is the one exception to "never conditionally mount."

---

### Network — Don't Waste Queries

**27. Void Detection** (`hasDataInDelta`)
Before querying: map slider values to histogram bins, check if any bin has count > 0. If no data in the delta, skip the query entirely.

**28. Debounced Text Filter (300ms)** (`handleTextChange`)
Wait for user to stop typing. One query, not one per keystroke.

**29. Range Drag = No Commit Until pointerUp**
While dragging: `onDrag` fires (visual update only). Only `onCommit` on `pointerUp` fires `applyFilters`. Dragging from 0 to 100 = 1 query, not 100. This two-event split also solves the behind-by-one stale closure (see #44) — the rAF commits state in one render, `pointerUp` queries in a later render, so `triggerFilters` always sees the committed range.

**30. First Ready Doesn't Wipe** (catch-up effect)
When pipeline first reaches 'ready', don't wipe the pre-flight data (JSON rows). Let it stay visible while the Arrow query fires in background. No skeleton flicker on first load.

---

### Profile Hydration — Lazy & Sequential

**31. Demand-Driven Hydration** (`useDataProfile`)
Only fetches attributes the UI actually needs (columnStats, cardinality, histograms). Attributes that are `null` (negative cache) are never re-fetched. A view that doesn't show histograms never pays for them.

**32. Polling for Background Computation** (`useDataProfile`)
Server returns 202 if attributes are still computing. Client polls every 1s, max 30 times. Computing cardinality for 100M rows takes time — let it happen without blocking the UI.

---

### Edge Cases

**33. Float Epsilon Tolerance** (`RangeSlider`)
OOB detection uses `epsilon = range * 0.001`. DuckDB → Arrow IPC → JS accumulates float drift. `9.999999999` must be treated as `10`.

**34. Uncontrolled Input Sync** (`syncTrack`)
Range inputs are uncontrolled HTML. When React state changes (filter applied, constrained bounds update), `syncTrack` manually writes `.value`. Numeric comparison avoids float-string fuzz.

**35. Per-Row Skeleton Randomization**
Each skeleton bar gets pseudo-random width: `55 + ((i * 17 + colName.length * 11) % 40)`. Uniform skeletons look fake.

**36. Character-Based Column Widths** (`colWFromName`)
Max char length × 7.5px + chrome. Adaptive sizing based on actual data, not hard-coded widths.

---

### Typography & Geometry — Subpixel Stillness

**37. Typographic Jitter Lock** (`tabular-nums`)
`font-variant-numeric: tabular-nums` on all telemetry readouts (`.sigil`, River Gauge, row counts). Forces every digit to occupy equal width. Without it, `111` is narrower than `999` and text jitters as numbers change.

**38. The 12px Earthquake** (`scrollbar-gutter: stable`)
When the Vault Door opens and data hydrates, `overflow-y: auto` injects a scrollbar — shifting the entire table 12px left. `scrollbar-gutter: stable` reserves the space permanently. Applied to: `<main>`, table scroll container.

**39. Ghost Hitbox** (slider thumb `box-shadow: 0 0 0 8px transparent`)
The 14px slider thumb is too small to hit reliably. An 8px transparent `box-shadow` expands the hit area to 30px without changing the visual size. Can't use `::after` on pseudo-elements, so the shadow acts as the ghost.

---

### DOM Physics — Blast Walls & GPU Layers

**40. CSS Containment** (`contain: layout style paint`)
Applied to `.vault-door`, `.glass-canopy`, `.sidebar-surface`. Tells the browser's C++ layout engine: "Nothing inside this box affects geometry outside it." Reflows from text changes, filter updates, or data hydration are physically isolated. No cascade up the DOM tree.

**41. GPU Layer Promotion** (`will-change` on hover)
- `.vault-door:hover { will-change: transform }` — pre-promotes to GPU layer before click
- `.river-fill { will-change: clip-path }` — always promoted since it animates continuously
Not applied globally — each `will-change` costs VRAM. Only where animations actually fire.

**44. Ref-Sync for Batched State** (`ParquetPreview.tsx: selectedRef, rangeRef, textRef`)
React batches `setState` — calling `setSelected(next)` then `triggerRef.current()` in the same handler means `triggerFilters` reads the *previous* `selected` from its closure. The query fires with yesterday's filters. Fix: maintain a `useRef` mirror for each filter state. Sync the ref *inside* the functional updater (which executes synchronously before `startTransition`). `triggerFilters` reads `.current` — always the present, never the past. Range sliders solved this earlier by splitting drag (rAF state update) from commit (`pointerUp` query) — two separate events, two separate renders, so state is committed by the time the query fires. Categorical chips and text filters don't have that two-event luxury, so they need the ref-sync.

---

### Future Architecture (Not Yet Implemented)

**42. Web Worker Arrow Decoding**
Arrow IPC frames are currently decoded on the main thread. A 10MB chunk halts the UI. The fix: move `apache-arrow` decoding into a Web Worker, pass parsed `ArrayBuffer` back via `Transferable Objects` (zero-copy ownership transfer). UI stays 120fps while gigabytes decode in the dark.

**43. FinalizationRegistry (Memory Leak Protection)**
Arrow Tables are heavy contiguous allocations. When evicted from the LRU cache (max 10), JS GC eventually cleans them. `FinalizationRegistry` would provide an explicit hook to call `.free()` / `.release()` if we ever introduce WASM decoders (DuckDB-WASM, Rust-compiled). Prevents memory fragmentation.

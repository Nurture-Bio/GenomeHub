# Living Dashboard — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the ParquetPreview's static table+sidebar with a "Living Dashboard" — a 60fps, bio-native data surface that fuses Continuous Compute (Paradigm 2) and Bio-Native rendering (Paradigm 3) with Meso-to-Micro semantic zoom for single-dataset navigation.

**Architecture:** Dual-layer rendering — React Shell for structural chrome, Canvas/rAF for data-dense visualizations. DuckDB WASM queries run in a worker; results flow to Canvas renderers via typed array refs, bypassing React reconciliation for high-frequency interactions. Column shape inference maps biological column semantics to specialized visualizer components.

**Tech Stack:** React 19, DuckDB WASM, Zustand, `@tanstack/react-virtual`, Canvas 2D (no WebGL — overkill for 2D statistical plots), `requestAnimationFrame`.

---

## 1. The Engine-to-Glass Pipeline

### Problem

Every slider `mousemove` currently debounces → `applyFilters()` → `conn.query()` → `setFilteredCount()` → React re-render → DOM diff → paint. At 60fps (16ms budget), React reconciliation alone eats 5-12ms. The query itself adds 10-50ms depending on dataset size. Result: choppy, laggy interaction — the antithesis of "living."

### Solution: Three-Tier State Architecture

```
Tier 1: Continuous State (refs + rAF)
────────────────────────────────────
Slider thumb position, hover coordinates, drag offsets.
NEVER stored in React state. Written to refs. Read by Canvas
renderers on every animation frame. Cost: 0ms React overhead.

Tier 2: Query State (Zustand store, external to React)
────────────────────────────────────
Active filter specs, sort order, zoom level, column visibility.
Updated on slider RELEASE (not drag). Zustand subscriptions
trigger Canvas repaints AND fire DuckDB queries. React
components subscribe only to structural changes (column
list, zoom level) via Zustand selectors.

Tier 3: Structural State (React useState)
────────────────────────────────────
Component mount/unmount decisions: which visualizer type
is rendered for which column, panel layout, error states.
Changes rarely — only on initial load, column shape
inference, or user layout changes.
```

### The Hot Path: Slider Drag → Canvas Repaint

```
User drags slider
  │
  ├─► ref.current = newValue        (0ms — pointer write)
  │
  ├─► requestAnimationFrame()       (next vsync)
  │     └─► Canvas renderer reads ref
  │         └─► Repaints histogram with "preview range" overlay
  │             (shows WHERE the filter WILL land — no query yet)
  │
  └─► onPointerUp / debounce(120ms)
        └─► Zustand store.setFilter(column, range)
              ├─► DuckDB worker: SELECT COUNT(*) ... WHERE col BETWEEN $1 AND $2
              │     └─► Result (single number) → store.setFilteredCount()
              │           └─► Zustand subscription → Canvas repaints distribution
              │
              └─► DuckDB worker: SELECT col, COUNT(*) GROUP BY col (for histogram)
                    └─► Result (typed Float64Array) → store.setHistogramData()
                          └─► Canvas repaints histogram bars
```

During the drag, the user sees the **slider thumb moving** and a **translucent overlay** on the histogram showing the selected range — all at 60fps, all via refs + rAF, zero React. Only on release does the "real" query fire.

### DuckDB Query Results → Canvas

DuckDB WASM returns Arrow IPC batches. For aggregation queries (histograms, distributions), results are tiny — a few hundred numbers at most. The bottleneck isn't data transfer, it's React re-rendering the visualization.

```typescript
// QueryBridge — thin layer between Zustand and DuckDB worker
class QueryBridge {
  private store: DashboardStore;

  // Fire-and-forget: result goes to store, Canvas reads from store
  async queryHistogram(column: string, bins: number, filters: FilterSpec[]) {
    const { conn } = await ensureDb();
    const sql = this.compileHistogramQuery(column, bins, filters);
    const result = await conn.query(sql);

    // Extract to Float64Array — Canvas reads this directly
    const counts = new Float64Array(result.getChild('count')!.toArray());
    const edges  = new Float64Array(result.getChild('edge')!.toArray());

    this.store.setHistogram(column, { counts, edges });
    // Canvas auto-repaints via Zustand subscription (not React)
  }
}
```

### Why Not SharedArrayBuffer?

DuckDB WASM doesn't expose SAB — it uses structured clone for IPC. For aggregation queries (our hot path), results are < 1KB. Structured clone is < 1ms. SAB would add complexity for zero measurable gain. If we ever need SAB (e.g., streaming 1M-row results for scatter plots), we can add a thin SAB bridge layer later.

### Why Not WebGL?

Our visualizations are 2D statistical plots: histograms, heatmaps, sparklines. Canvas 2D handles these at 60fps with headroom. WebGL adds shader complexity, context management, and mobile compatibility issues for zero visual benefit. The one exception might be a future genome-scale scatter plot (millions of dots) — that's a WebGL candidate, but it's not in scope for V1.

---

## 2. Bio-Native Component Mapping

### The Column Profiler

When a Parquet file loads, the Column Profiler examines each column's **name**, **type**, and **value distribution** to infer its biological semantics. This determines which visualizer component is mounted.

```typescript
type SemanticType =
  | 'chromosome'    // Filter: karyotype ideogram
  | 'position'      // Filter: genomic coordinate range slider
  | 'sequence'      // Cell: colored ATCG blocks
  | 'quality'       // Cell: gradient heatmap, Filter: range slider
  | 'strand'        // Filter: +/- toggle
  | 'gene'          // Filter: searchable tag cloud
  | 'count'         // Filter: histogram range, Cell: heat-colored number
  | 'mismatch'      // Filter: discrete 0-N selector
  | 'numeric'       // Filter: range slider, Cell: aligned number
  | 'categorical'   // Filter: multi-select chips
  | 'text'          // Filter: search box
```

### Inference Rules (Priority Order)

```
1. NAME MATCH (regex on column name — highest priority)
   /^(chr|chrom|chromosome)$/i         → chromosome
   /^(pos|position|start|end|bp)$/i    → position
   /^(seq|sequence|guide|spacer)$/i    → sequence
   /^(qual|quality|mapq|phred)$/i      → quality
   /^strand$/i                         → strand
   /^(gene|gene_name|gene_id|symbol)$/i → gene
   /^(count|depth|coverage|reads)$/i   → count
   /^(mm|mismatches|edit_distance)$/i  → mismatch

2. VALUE VALIDATION (sample first 100 values to confirm)
   chromosome: values match /^(chr)?([0-9]{1,2}|[XYM]|MT)$/i
   sequence:   values match /^[ATCGNatcgn]+$/
   strand:     values are subset of {'+', '-', '.'}
   quality:    numeric, range 0-60 (Phred-like)

3. TYPE + CARDINALITY FALLBACK
   numeric + any cardinality              → numeric
   string  + distinct ≤ 50                → categorical
   string  + distinct > 50                → text
```

### Visualizer Registry

```typescript
// Each semantic type maps to a filter component and a cell renderer
const VISUALIZER_REGISTRY: Record<SemanticType, {
  FilterComponent: React.FC<FilterProps>;
  CellRenderer:    CanvasCellRenderer | null;  // null = use default DOM
}> = {
  chromosome: {
    FilterComponent: KaryotypeFilter,     // clickable ideogram
    CellRenderer:    null,                // plain text is fine
  },
  sequence: {
    FilterComponent: TextSearchFilter,    // regex-capable search
    CellRenderer:    nucleotideRenderer,  // A=green T=red G=yellow C=blue
  },
  quality: {
    FilterComponent: RangeSliderFilter,
    CellRenderer:    qualityHeatRenderer, // gradient background
  },
  mismatch: {
    FilterComponent: DiscreteStepFilter,  // 0 1 2 3 toggle chips
    CellRenderer:    mismatchRenderer,    // color: 0=green, 1=yellow, 2+=red
  },
  // ...etc
};
```

### How It Plugs In

```
Parquet loads → DESCRIBE → raw columns
  │
  └─► ColumnProfiler.profile(columns, sampleRows)
        │
        ├─► For each column:
        │     1. Match name against regex patterns
        │     2. Sample 100 values for validation
        │     3. Fall back to type + cardinality
        │     4. Return ColumnProfile { name, type, semanticType, stats, card }
        │
        └─► Store profiles in Zustand
              │
              └─► FilterSidebar reads profiles
                    └─► For each column, mount VISUALIZER_REGISTRY[semanticType].FilterComponent
                          └─► Bio-native filter controls appear automatically
```

### V1 Scope

We are NOT building all visualizers in V1. V1 ships:

| Semantic Type | Filter Component | Cell Renderer |
|---|---|---|
| `chromosome` | KaryotypeFilter (if ≤ 24 values) or InlineSelect | Default DOM |
| `sequence` | TextSearchFilter | NucleotideCanvas (colored ATCG blocks) |
| `mismatch` | DiscreteStepFilter (0-N chips) | MismatchColor (green→red) |
| `numeric` | RangeSlider (existing, upgraded to Canvas histogram) | HeatNumber (existing) |
| `categorical` | MultiSelect/InlineSelect (existing) | Default DOM |
| `text` | TextSearch (existing) | Default DOM |

Everything else (`position`, `quality`, `strand`, `gene`) uses the generic fallback. The registry pattern means adding them later is one file per visualizer — no architectural changes.

---

## 3. The Meso-to-Micro Zoom

### Concept

A single dataset view has three "altitude" levels. The user transitions between them via scroll wheel (Ctrl+Scroll or pinch-to-zoom on trackpad). This is NOT page scrolling — it changes what the data surface renders.

```
MESO (Zoom 0.0) — Distribution Dashboard
├── Each column rendered as a distribution card
├── Histograms, value clouds, sparklines
├── No individual rows — pure aggregate overview
├── "What does this dataset LOOK LIKE?"
│
TRANSITION (Zoom 0.3-0.7) — Compact Table + Sparklines
├── Column headers expand to show mini-distributions
├── Table rows begin to materialize
├── Distribution cards shrink into header sparklines
│
MICRO (Zoom 1.0) — Full Virtualized Table
├── Individual rows with bio-native cell renderers
├── Column headers show sort controls + type badge
├── This is the current ParquetPreview (upgraded)
├── "Show me the actual data."
```

### Implementation

```typescript
// In Zustand store
interface DashboardStore {
  zoomLevel: number;         // 0.0 = meso, 1.0 = micro
  setZoomLevel: (z: number) => void;
}

// Zoom handler — Ctrl+Scroll changes zoom, plain scroll scrolls table
function handleWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return; // let normal scroll through
  e.preventDefault();
  const delta = -e.deltaY * 0.003;  // smooth, not jumpy
  store.setZoomLevel(clamp(store.zoomLevel + delta, 0, 1));
}
```

### Visual Transition

The zoom doesn't swap components — it **transforms** them:

```
Zoom 0.0:
┌────────────────────────────────────────────┐
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐      │
│ │ chr  │ │ pos  │ │ mm   │ │ seq  │ ...  │
│ │      │ │      │ │      │ │      │      │
│ │[hist]│ │[hist]│ │[bar] │ │[freq]│      │
│ │      │ │      │ │      │ │      │      │
│ └──────┘ └──────┘ └──────┘ └──────┘      │
│                                            │
│ (no rows)                                  │
└────────────────────────────────────────────┘

Zoom 0.5:
┌────────────────────────────────────────────┐
│  chr ▂▃▅  pos ▁▃▅▇  mm ▅▃▁  seq ▂▅▃▁    │  ← sparklines in headers
│──────────────────────────────────────────  │
│  chr1   34501    0   ATCGATCG...          │  ← rows materializing
│  chr2   12044    1   GCTAGCTA...          │
│  chr1   98712    0   TTAACCGG...          │
└────────────────────────────────────────────┘

Zoom 1.0:
┌────────────────────────────────────────────┐
│  chr ▴  pos ▴  mm ▴  seq               │  ← full sort controls
│  VARCHAR  INTEGER  INTEGER  VARCHAR        │
│──────────────────────────────────────────  │
│  chr1   34,501    0   ATCGATCG...          │
│  chr2   12,044    1   GCTAGCTA...          │
│  chr1   98,712    0   TTAACCGG...          │
│  chrX   44,201    2   AATTCCGG...          │
│  chr3    8,932    0   CCGGTTAA...          │
│  ...                                       │
└────────────────────────────────────────────┘
```

### CSS-Driven Transition

Distribution cards and table rows coexist in the DOM. The zoom level controls their opacity, scale, and max-height via CSS custom properties:

```css
.distribution-cards {
  opacity: calc(1 - var(--zoom));
  max-height: calc((1 - var(--zoom)) * 400px);
  transform: scale(calc(0.5 + 0.5 * (1 - var(--zoom))));
  overflow: hidden;
  transition: none; /* instant — driven by rAF */
}

.data-table {
  opacity: var(--zoom);
  flex: var(--zoom);
}

.header-sparkline {
  opacity: var(--zoom);
  height: calc(var(--zoom) * 20px);
}
```

The CSS custom property `--zoom` is set via `element.style.setProperty('--zoom', zoomLevel)` inside a rAF callback — no React re-render, pure CSSOM manipulation.

### V1 Scope

V1 ships zoom levels 0.0 (meso) and 1.0 (micro) as **two discrete modes** toggled by a button or keyboard shortcut (e.g., `Ctrl+D` for "distribution view"). The smooth scroll-to-zoom transition is V2. The infrastructure (CSS custom property, distribution cards existing in DOM) supports the smooth transition without architectural changes.

---

## 4. The "Big Bang" Ingestion

### The Zero-Time-to-Value Moment

When a biologist drops a file onto GenomeHub, they should see data — not a progress bar. The sequence:

```
0ms    File dropped → Omni-Dropzone captures
       ├─► Upload starts (background)
       └─► Client reads first 64KB of the file locally (File API)
             └─► Column shape inference from headers/first rows
                   └─► Dashboard layout determined

100ms  Dashboard "unfurls" — empty visualizer cards mount
       ├─► Skeleton sparklines appear
       └─► Column names + types visible

500ms  First batch of local data scanned (1000 rows from File API)
       └─► Distribution cards populate with sample distributions
           └─► Biologist sees the SHAPE of their data

~5s    Upload completes → server converts to Parquet

~8s    Parquet ready → DuckDB registers file → full dataset available
       └─► Distributions refine from sample → full dataset
           └─► Seamless transition — no page reload, no "now loading"
```

### Implementation

The key architectural piece: a `LocalFileScanner` that reads from the browser's File API (no upload needed) and produces the same `ColumnProfile[]` that the Parquet path produces.

```typescript
class LocalFileScanner {
  // Read first N rows from a local File object
  async scan(file: File, limit: number): Promise<{
    columns: ColumnProfile[];
    sampleRows: Record<string, unknown>[];
  }> {
    const slice = file.slice(0, 64 * 1024); // first 64KB
    const text = await slice.text();
    // Detect format (JSON array, CSV, TSV, NDJSON)
    // Parse headers + first `limit` rows
    // Run ColumnProfiler on the sample
    return { columns, sampleRows };
  }
}
```

This reuses the existing `JsonHeadScanner` infrastructure (already built in `scanners.ts`) and the new `ColumnProfiler`.

### V1 Scope

V1: The Living Dashboard activates after Parquet conversion completes (current behavior, but with bio-native rendering). The "instant local scan" Big Bang is V2 — it requires the `LocalFileScanner` and a state machine that transitions from "local sample" to "full Parquet" without jarring the user.

---

## 5. Zustand Store Design

```typescript
interface DashboardStore {
  // ── Structural (drives component mounting) ──
  fileId:          string | null;
  columns:         ColumnProfile[];  // includes semanticType
  status:          DashboardStatus;
  zoomLevel:       number;           // 0=meso, 1=micro

  // ── Query (drives DuckDB queries + Canvas repaints) ──
  filters:         FilterSpec[];
  sort:            SortSpec | null;
  totalRows:       number;
  filteredCount:   number;

  // ── Visualization data (Canvas reads these directly) ──
  histograms:      Record<string, { counts: Float64Array; edges: Float64Array }>;
  constrainedStats: Record<string, ColumnStats>;

  // ── Actions ──
  setFilter:       (column: string, op: FilterOp | null) => void;
  setSort:         (spec: SortSpec | null) => void;
  setZoomLevel:    (z: number) => void;
  clearAllFilters: () => void;
  loadFile:        (fileId: string) => Promise<void>;
}
```

### Subscription Pattern

Canvas renderers subscribe to specific store slices:

```typescript
// Canvas histogram — only repaints when its slice changes
function HistogramCanvas({ column }: { column: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Subscribe directly to store — NO React re-render
  useEffect(() => {
    return dashboardStore.subscribe(
      state => state.histograms[column],
      (histogram) => {
        if (!histogram || !canvasRef.current) return;
        paintHistogram(canvasRef.current, histogram);
      }
    );
  }, [column]);

  return <canvas ref={canvasRef} />;
}
```

---

## 6. Component Hierarchy

```
<LivingDashboard fileId={id}>
  ├── <DashboardHeader>
  │     ├── Row count + filter status
  │     ├── Zoom toggle (Meso ↔ Micro)
  │     └── Clear all filters
  │
  ├── <FilterSidebar>            ← existing, upgraded
  │     ├── Per-column filter controls
  │     │     ├── <KaryotypeFilter>    (if chromosome)
  │     │     ├── <DiscreteStepFilter> (if mismatch)
  │     │     ├── <HistogramRangeFilter> (if numeric — Canvas histogram + range)
  │     │     ├── <MultiSelectFilter>  (if categorical)
  │     │     └── <TextSearchFilter>   (if text)
  │     └── Rendered from ColumnProfile[].semanticType
  │
  ├── <MesoView>                 ← NEW — zoom 0.0
  │     └── <DistributionGrid>
  │           ├── <DistributionCard column={col}>
  │           │     └── <canvas>  ← histogram/bar chart
  │           └── One card per column
  │
  └── <MicroView>                ← upgraded ParquetPreview table
        ├── <TableHeader>
        │     ├── Column cells with sort + resize
        │     └── (sparklines at intermediate zoom)
        └── <VirtualRows>        ← existing, upgraded with bio-native cells
              └── Per-cell renderer chosen by semanticType
                    ├── nucleotideRenderer  → colored ATCG blocks
                    ├── mismatchRenderer   → green/yellow/red number
                    ├── heatNumberRenderer → gradient background (existing)
                    └── defaultRenderer    → plain text (existing)
```

---

## 7. Build Sequence

### Phase 1: Foundation (Zustand + Column Profiler)
1. Create Zustand store — migrate filter/sort/count state out of ParquetPreview
2. Build ColumnProfiler — name regex + value validation + fallback
3. Wire profiler into useParquetPreview init sequence
4. ParquetPreview reads from Zustand instead of local state
5. Verify: existing functionality unchanged, all state in Zustand

### Phase 2: Bio-Native Filters
6. Build KaryotypeFilter — clickable chromosome boxes (Canvas)
7. Build DiscreteStepFilter — 0/1/2/3/N toggle chips
8. Build HistogramRangeFilter — Canvas histogram with draggable range overlay
9. FilterSidebar reads ColumnProfile.semanticType → mounts correct filter
10. Verify: chromosome columns get ideogram, mismatch gets step chips

### Phase 3: Bio-Native Cell Renderers
11. Build nucleotideRenderer — Canvas-drawn colored ATCG blocks in table cells
12. Build mismatchRenderer — color-coded mismatch count
13. VirtualRows dispatches to correct renderer per column
14. Verify: sequence columns show colored blocks, mismatches show color

### Phase 4: Continuous Compute Hot Path
15. Refactor slider interactions to use refs + rAF (no React state during drag)
16. HistogramRangeFilter: drag shows preview overlay at 60fps, query fires on release
17. Zustand subscription → Canvas repaint (bypass React)
18. Verify: slider drag is visually smooth, no dropped frames

### Phase 5: Meso View
19. Build DistributionCard — Canvas-rendered column distribution
20. Build MesoView — grid of DistributionCards
21. Add zoom toggle (button/keyboard) to switch Meso ↔ Micro
22. Wire zoom level to CSS custom properties for transition
23. Verify: user can toggle between distribution overview and table view

---

## 8. What We Are NOT Building (YAGNI)

- WebGL rendering (Canvas 2D is sufficient for V1 visualizations)
- SharedArrayBuffer pipeline (DuckDB structured clone is fast enough for aggregation)
- Smooth scroll-to-zoom transition (V2 — V1 uses discrete toggle)
- Local file scanning / Big Bang instant preview (V2 — V1 activates after Parquet ready)
- Genome browser / coordinate-aware visualizations (V2+)
- Cross-dataset queries / multi-file views (V2+)
- Keyboard-first navigation / j/k hotkeys (separate workstream)
- Server-side metadata extraction (separate workstream)

---

## 9. Risk Assessment

| Risk | Mitigation |
|---|---|
| Canvas text rendering looks blurry on HiDPI | Use `devicePixelRatio` scaling on all Canvas elements |
| DuckDB aggregation queries > 50ms on large files | Use Parquet row group statistics (no data scan) for histograms; only scan when user explicitly requests |
| Zustand migration breaks existing filter behavior | Phase 1 is pure refactor — verify identical behavior before adding new features |
| Column name inference false positives | Validation step (check actual values, not just name) + user override |
| Canvas cell renderers conflict with virtualized row recycling | Clear Canvas on virtualized item unmount; use stable keys |

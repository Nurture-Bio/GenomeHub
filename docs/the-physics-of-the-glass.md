# The Physics of the Glass

*A grimoire for those who will tend the instrument after us.*

---

## Prologue

A novice once asked the Master: "What is the purpose of a data interface?"

The Master held up a pane of glass. "When you look through glass, you do not see the glass. You see the world beyond it. The moment the glass draws attention to itself—a smudge, a crack, a shimmer of lag—the illusion is broken, and the scientist sees the tool instead of the truth."

"Then how do we make the glass invisible?"

"By respecting the physical laws that govern the space between the Hand and the Water."

This document describes those laws as they are implemented in `ParquetPreview.tsx` and the server-side query pipeline.

---

## I. The Separation of the Hand and the Void
*On Dragging and the Immunity Shield*

### The Koan
The novice dragged the slider and watched the screen freeze. "Master, the Glass has stopped breathing!"

The Master closed his eyes. "You tied the Hand to the Void. When the Hand moves at sixty frames per second, and the Void answers in two hundred milliseconds, you have asked the Hand to wait for the Void. The Hand will always be faster than the Void. Untie them."

### The Physics
The slider lives in the user's browser. The data lives on an AWS server. Between them lies the Void—network latency. If the UI state is coupled to the network, we suffer from the **Equation of Cloud Resistance**:

$$
\text{UI Friction} = \text{Network Latency} \times \text{State Coupling}
$$

To drive UI friction to $0$, we must drive State Coupling to $0$.

**The CSS Variable Engine:** The slider's visual position is not bound to React state at all. Six CSS custom properties on a single container DOM node are the *sole* source of positional truth during a drag:

| Variable | Governs |
|---|---|
| `--lo` | Low thumb position (0–100%) |
| `--hi` | High thumb position (0–100%) |
| `--c-lo` | Constrained data minimum (server truth) |
| `--c-hi` | Constrained data maximum (server truth) |
| `--oob-lo` | Left amber void opacity (0 or 0.5) |
| `--oob-hi` | Right amber void opacity (0 or 0.5) |

Every track segment, every void glow, every ghost mask clip rect is expressed as pure `calc()` on these six variables. When the Hand moves, `syncTrack()` writes six `style.setProperty()` calls on one DOM node. The GPU paints the delta. React's reconciler never wakes.

```typescript
const syncTrack = useCallback((loVal: number, hiVal: number) => {
  const el = trackRef.current;
  if (!el) return;
  const loPct = ((loVal - min) / range) * 100;
  const hiPct = ((hiVal - min) / range) * 100;
  el.style.setProperty('--lo', String(loPct));
  el.style.setProperty('--hi', String(hiPct));

  // OOB detection — drives amber void + thumb color
  const oobLo = !pending && hasConData && loVal < activeConMin! - epsilon;
  const oobHi = !pending && hasConData && hiVal > activeConMax! + epsilon;
  el.style.setProperty('--oob-lo', oobLo ? '0.5' : '0');
  el.style.setProperty('--oob-hi', oobHi ? '0.5' : '0');

  // Thumb colors — direct DOM writes, bypass reconciliation
  // Input values — force uncontrolled inputs to match during panning
  // DistributionPlot clip — inherits --lo/--hi via CSS, zero JS needed
}, [...]);
```

**The Immunity Shield:** The sync effect that writes CSS vars from React props guards itself against the drag:

```typescript
useEffect(() => {
  if (!isDragging && !isPanning) syncTrack(low, high);
}, [low, high, isDragging, isPanning, syncTrack]);
```

While the Hand moves, props are ignored. When the Hand releases, the effect fires once and reconciles.

**The Void Detector:** Why query the server if the user drags through empty space? We use the `staticHistogram` to mathematically prove the absence of data:

```typescript
function hasDataInDelta(oldVal, newVal, min, max, histogram): boolean {
  const toBin = (v) => Math.max(0, Math.min(n - 1, Math.floor(((v - min) / range) * (n - 1))));
  for (let i = toBin(Math.min(oldVal, newVal)); i <= toBin(Math.max(oldVal, newVal)); i++) {
    if (histogram[i] > 0) return true;
  }
  return false;
}
```

**The Data Pipeline:** While CSS vars handle the visual, `onDrag()` simultaneously feeds the parent's rAF-throttled pipeline. The parent batches state updates at 60fps, triggering queries that update dynamic histograms and constrained bounds. The two pipelines—visual and data—run in parallel, perfectly decoupled.

---

## II. The Ghost and the Truth

*On Clipping and Superposition*

### The Koan

The novice pointed at the histogram. "Master, when I narrow the range, the shape outside the handles should disappear!"

The Master shook his head. "No. The shape outside the handles is the *context*. Without it, the scientist cannot judge the proportion of what they have selected. The whole must always remain visible, even when cut away."

### The Physics

The distribution plot is composed of two layers of SVG `<rect>` elements. Their relationship is governed by the **Equation of State Superposition**:

$$
\text{Visual State}(t) = \begin{cases} \text{Static Masked} & t < t_{\text{hydrate}} \\ \text{Dynamic Morph} & t = t_{\text{hydrate}} \end{cases}
$$

**The Static Layer (The Ghost):** Renders all bins of the `staticHistogram` at low opacity (`0.12`). It is **never clipped**. It is the absolute reference frame.

**The Dynamic Layer (The Truth):** Renders `activeBins`. It is **always mounted** (the Genesis Render) and **always clipped** to the Ghost Mask. If it were unclipped, the pre-filtered Genesis shape would flare brightly outside the handles while waiting for the network.

**The Pure CSS Ghost Mask:** The clip `<rect>` inherits its position from CSS custom properties set on the parent gauge container. No imperative handle. No `setClip()`. No ref. The GPU reads the variables, computes the clip, and paints—entirely below the JavaScript thread:

```tsx
<defs>
  <clipPath id={clipId}>
    <rect y="0" height={height} style={{
      x: 'calc(var(--lo) * 1%)',
      width: 'max(0px, calc((var(--hi) - var(--lo)) * 1%))',
    }} />
  </clipPath>
</defs>
```

The SVG `viewBox` is `0 0 100 ${height}`, so `1%` maps to exactly one unit. `--lo` and `--hi` are 0–100 values. The math is absolute.

`DistributionPlot` receives no position props, no handleRef, no imperative bridge. Its custom memo comparator only watches `staticBins`, `dynamicBins`, `height`, and `pending`. During a drag, it performs **zero re-renders**. The 128 SVG rects stand perfectly still while the GPU slides the clip mask beneath them.

---

## III. The Breath of the Glass

*On Animation*

### The Koan

The novice watched the histogram bars snap into place. "Master, the shape is correct, but it feels dead."

The Master placed his hand on the novice's chest. "Waiting should feel like breathing, not dying."

### The Physics

If the UI is completely static during network latency, the brain perceives it as broken. We mitigate this via the **Equation of Perceptual Latency**:

$$
\text{Perceived Wait} = \text{Actual Latency} \times (1 - \text{Visual Kinematics})
$$

**The Breath:** When `pending === true`, the dynamic layer gently pulses, offloaded entirely to the browser's compositor thread:

```css
@keyframes distPlotBreath {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 0.25; }
}
```

**The Liquid Morph:** Because the dynamic layer is constructed of stable `<rect>` elements (not a single `<path>`), we apply pure CSS geometry transitions. When the new distribution arrives, the bars fluidly equalize:

```tsx
<rect
  y={height - barH}
  height={barH}
  style={{ transition: 'y 300ms ease-out, height 300ms ease-out' }}
/>
```

**The Transition Discipline:** Only `opacity`, `y`, and `height` may carry CSS transitions. Positional properties bound to the Hand—`left`, `width`, `x`—must have **0ms transition**. The Hand must never feel rubber-banded to the glass.

### The Performance Contract

During a drag, the render cost is $O(0)$—literally zero React reconciliation:

```
User drags thumb
  → native <input> onChange fires (uncontrolled — browser owns the thumb)
  → syncTrack() writes 6 CSS variables on one DOM node
  → syncTrack() writes 4 style properties on two <input> elements (thumb color)
  → onDrag() feeds the parent's rAF-throttled pipeline (data queries flow)
  → CSS calc() on track segments repaints via GPU
  → CSS calc() on SVG <clipPath> <rect> repaints via GPU
  → DistributionPlot does NOT re-render (memo comparator blocks it)
  → 128 SVG rects (64 static + 64 dynamic) stand frozen in the DOM
  → React reconciler: silent
```

This is not an optimization. This is the *only correct architecture*. Reconciling 128 virtual DOM nodes at 60 FPS is a tax that compounds across every slider on screen. The CSS Variable Engine eliminates that tax entirely.

---

## IV. The Kinetic Gauge

*On Amplitude, Panning, and the Amber Resonance*

### The Koan

The novice squinted at the sparkline. "Master, the histogram is too short. I cannot see the shape of the data changing."

The Master handed the novice a magnifying lens. "You built a gauge, but you gave it the depth of a scratch. A scientist needs an *instrument*—something with wells deep enough to see the water move."

### The Physics

Three upgrades transform the sparkline into a kinetic instrument.

**The Deep Well:** The histogram rises from 20px to 56px (`PLOT_H = 56`). The entire gauge—histogram, track, number readouts—sits inside a segregated container with a sunken background (`oklch(0.13 0.01 240 / 0.5)`), `border-radius: 6px`, and internal padding. This gives the gauge a "physical instrument" feel, visually distinct from the column label above it.

**The Shifting Window:** A pannable track element sits between the two thumbs at `z-index: 2` (below thumb inputs at 3/4). It catches pointer events that pass through the `pointer-events: none` range inputs but miss the thumbs. On `pointerDown`, it captures the pointer and attaches global `pointermove`/`pointerup` listeners. The window slides as a rigid body—both handles move together, maintaining width, clamped so the window stays within `[min, max]`. The pan handler writes directly to `syncTrack()`, which drives CSS variables and feeds `onDrag()` simultaneously.

**The Amber Resonance:** When a thumb exceeds the constrained data range, an amber void track glows on the number line between the thumb and the density boundary:

```tsx
{/* Left amber void — thumb → density boundary (CSS-driven) */}
<div style={{
  left: 'calc(var(--lo) * 1%)',
  width: 'max(0%, calc((var(--c-lo) - var(--lo)) * 1%))',
  opacity: 'var(--oob-lo)',
  boxShadow: '0 0 6px oklch(0.750 0.185 60 / 0.28)',
}} />
```

When `--lo >= --c-lo`, the `max(0%, ...)` collapses the width to zero. The amber vanishes. No React conditional. No `{lowOob && ...}`. The CSS math *is* the condition.

### The Unified Language of the Number Line

The number line speaks exactly three colors:

| Segment | Color | CSS Expression | Meaning |
|---|---|---|---|
| Ghost base | Cyan, 10% | Full width, static | The scale itself |
| Truth track | Cyan, 40% | `left: max(--lo, --c-lo)`, `right: max(100-hi, 100-c-hi)` | Where data *exists* between the thumbs |
| Void track | Amber, 50% | `left: --lo`, `width: --c-lo - --lo` | Where the thumb has reached beyond the water |

Cyan means *data*. Amber means *void*. They never overlap. They never fight. The CSS variables are the single, immutable physical law that governs both.

---

## V. The Unshackling

*On Uncontrolled Inputs and the Handshake Protocol*

### The Koan

The novice released the thumbscrew and watched the ghost snap to a different position. "Master! The hand let go, but the glass disagrees with where I left it!"

The Master traced the signal path. "You chained the input to React with `value={low}`. React believes it owns the thumb. The browser believes it owns the thumb. Two kings in one castle. When you release, they fight, and the glass cracks."

### The Physics

HTML `<input type="range">` elements have two modes:

$$
\text{Controlled:} \quad \texttt{value=\{low\}} \implies \text{React owns the DOM node}
$$
$$
\text{Uncontrolled:} \quad \texttt{defaultValue=\{low\}} \implies \text{Browser owns the DOM node}
$$

In controlled mode, every React re-render resets the input's `.value` to the prop. During a drag, if the parent re-renders (from `onDrag` feeding the rAF pipeline), the browser's native thumb position fights React's prop. The inputs judder. The CSS variables (written by `syncTrack`) show one position; React's prop forces another. Two truths, one screen.

The solution: **unshackle the inputs**. `defaultValue` seeds the initial position. After that, the browser owns the DOM `.value`. React never touches it again unless we explicitly force it via `syncTrack()`.

```tsx
<input type="range"
  ref={lowInputRef}
  defaultValue={low}      // seed, not a leash
  onChange={e => {
    const v = Math.min(Number(e.target.value), highRef.current);
    lowRef.current = v;
    syncTrack(v, highRef.current);   // CSS vars follow the thumb
    onDrag(name, v, highRef.current); // data pipeline follows the thumb
  }}
/>
```

### The Handshake Protocol

When the Hand releases the glass, the DOM, the CSS, and React must agree on a single coordinate. This is non-trivial because the browser's `onChange` event may lag behind `pointerUp` by one event-loop tick during fast motions. `lowRef.current` may be stale by one pixel.

The law: **on drop, the DOM is the source of truth.** Read the physical input's `.value` directly:

```typescript
const handleDragEnd = () => {
  // The absolute DOM truth — onChange may lag behind the final pixel
  const actualLo = lowInputRef.current ? Number(lowInputRef.current.value) : lowRef.current;
  const actualHi = highInputRef.current ? Number(highInputRef.current.value) : highRef.current;

  // Hard sync — refs, CSS vars, and inputs all agree before anything else
  lowRef.current = actualLo;
  highRef.current = actualHi;
  syncTrack(actualLo, actualHi);

  setIsDragging(false);
  // ... void detection with actualLo/actualHi ...
  onDrag(name, actualLo, actualHi);
  onCommit(name);
};
```

### The Float Fuzz Guard

`syncTrack` forces uncontrolled inputs to match during panning, clip-to-reality, and reset. But `String(15.000000000001)` and `"15"` are different strings for the same visual position. Naive string comparison causes infinite-loop flickering.

The guard uses numeric comparison with a tolerance below the eye's threshold:

```typescript
if (loIn && Math.abs(Number(loIn.value) - loVal) > 1e-7) loIn.value = String(loVal);
if (hiIn && Math.abs(Number(hiIn.value) - hiVal) > 1e-7) hiIn.value = String(hiVal);
```

### The Quantization Theorem

For floating-point columns, `step="any"` allows infinite precision. The browser maps the thumb to the exact pixel coordinate. For integer columns, `step=1` is mathematically perfect. The old `range / 200` step forced a 0.5% iron grid—the user could never position the thumb at the exact edge of the data, resulting in tiny unclosable amber void tracks.

$$
\text{Step} = \begin{cases} \texttt{"any"} & \text{if float} \\ 1 & \text{if integer} \end{cases}
$$

### The OOB Epsilon

The epsilon for OOB detection is a *visual tolerance*, not a mathematical one. The DuckDB → Arrow IPC → JavaScript pipeline accumulates floating-point drift. If the thumb is within 0.1% of the constrained boundary, the scientist is *at* the edge. Honor their intent:

```typescript
const epsilon = range * 0.001;
const lowOob  = !pending && hasConData && low < activeConMin! - epsilon;
```

---

## VI. The Ocean and the Porch

*On Fetching and the Ephemeral Cache*

### The Koan

The novice returned from the Ocean, panting. "Master, I brought the Water! But the scientist left before I arrived."

The Master rubbed his temples. "If they are thirsty *now*, hand them a cup from the river, and let the apprentices fill the barrel in the background."

### The Physics

DuckDB can stream Parquet over HTTPS (S3), which is instant to start but suffers a $\approx 50\text{--}150\ \text{ms}$ penalty per query due to chunk seeking. Reading from a local NVMe disk takes $< 5\ \text{ms}$.

We optimize this via the **Equation of Ephemeral Locality**:

$$
\text{Latency}_{\text{Query}} = \begin{cases} O(N \cdot \text{RTT}_{S3}) & \text{if Remote} \\ O(\text{Disk}_{\text{I/O}}) & \text{if Local} \end{cases}
$$

Our Node.js backend implements a **Stream-While-Caching** architecture using a Mutex map:

```typescript
const inflight = new Map<string, Promise<void>>();

export async function resolveLocalParquet(s3Key: string): Promise<string> {
  const local = cachePath(s3Key);

  // 1. Fast path: If it's on disk, use local NVMe speeds
  if (await fileExists(local)) return local;

  // 2. Background Warmup: If not in flight, trigger async download
  if (!inflight.has(s3Key)) {
    const promise = downloadS3ToTempAndRename(s3Key, local)
      .finally(() => inflight.delete(s3Key));
    inflight.set(s3Key, promise);
  }

  // 3. The River Cup: Immediately return the S3 URI to DuckDB.
  // DuckDB streams natively over HTTP while the disk cache fills in the background.
  return duckdbSrc(s3Key);
}
```


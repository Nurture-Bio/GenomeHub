# The Physics of the Glass

*A grimoire for those who will tend the instrument after us.*

---

## Prologue

A novice once asked the Master: "What is the purpose of a data interface?"

The Master held up a pane of glass. "When you look through glass, you do not see the glass. You see the world beyond it. The moment the glass draws attention to itself—a smudge, a crack, a shimmer of lag—the illusion is broken, and the scientist sees the tool instead of the truth."

"Then how do we make the glass invisible?"

"By respecting four physical laws that govern the space between the Hand and the Water."

This document describes those four laws as they are implemented in `ParquetPreview.tsx` and the server-side query pipeline.

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

**Local Optimism & The Immunity Shield:** The slider's visual position is bound *only* to local React state during a drag. To prevent a delayed server response from violently snapping the slider out of the user's hand, we enforce an Immunity Shield:

```typescript
// Inside RangeSlider.tsx
useEffect(() => {
  // The Immunity Shield: Ignore server truth while the Hand is moving.
  if (isDragging) return;
  setLocalRange(constrainedStats);
}, [constrainedStats, isDragging]);
```

**The Coalescing Buffer:** We only dispatch the network request when the stone drops (`onChangeCommitted`), wrapped in a debounce to protect against hardware micro-bounces.

**The Void Detector:** Why query the server if the user drags through empty space? We use the `staticHistogram` to mathematically prove the absence of data:

```typescript
function hasDataInDelta(oldVal: number, newVal: number, min: number, max: number, histogram: number[]): boolean {
  const getIdx = (val: number) => Math.max(0, Math.min(63, Math.floor(((val - min) / (max - min)) * 64)));
  const idx1 = getIdx(oldVal), idx2 = getIdx(newVal);
  const [start, end] = [Math.min(idx1, idx2), Math.max(idx1, idx2)];

  // If the sum of bins in the delta is 0, the query is identical. Drop it.
  return histogram.slice(start, end + 1).some(count => count > 0);
}
```

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

**The Static Layer (The Ghost):** Renders all 64 bins of the `staticHistogram` at low opacity (`0.12`). It is **never clipped**. It is the absolute reference frame.

**The Dynamic Layer (The Truth):** Renders `activeBins`. It is **always mounted** (the Genesis Render) and **always clipped** to the Ghost Mask. If it were unclipped, the pre-filtered Genesis shape would flare brightly outside the handles while waiting for the network.

```tsx
<svg>
  <defs>
    {/* The Ghost Mask glides with the handles */}
    <clipPath id={clipId}>
      <rect x={lowPct} width={highPct - lowPct} height={height}
            style={{ transition: 'x 150ms ease-out, width 150ms ease-out' }} />
    </clipPath>
  </defs>

  {/* Static Ghost: Unclipped, absolute truth */}
  <g opacity={0.12}>{staticRects}</g>

  {/* Dynamic Truth: Clipped, breathing, morphing */}
  <g clipPath={`url(#${clipId})`} style={{ opacity: pending ? 0.5 : 1 }}>
    {activeRects}
  </g>
</svg>
```

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

**The Liquid Morph:** Because the dynamic layer is constructed of 64 stable `<rect>` elements (not a single `<path>`), we can apply pure CSS geometry transitions. When the new distribution arrives, the bars fluidly equalize:

```tsx
<rect
  y={height - barH}
  height={barH}
  style={{ transition: 'y 300ms ease-out, height 300ms ease-out' }}
/>
```

---

## IV. The Ocean and the Porch

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

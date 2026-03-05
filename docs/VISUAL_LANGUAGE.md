# The Visual Language — Range Slider Physics

## Optimistic Histogram Projection

The range slider projects a local histogram estimate from the static (unfiltered)
distribution during drag, before the server responds. When the server result arrives,
bars that cross-filtering excluded "fall off" — that delta is the science.

Two architectural decisions govern correctness.

---

### 1. Slider Phase State Machine

A single `SliderPhase` value with explicit transitions. No boolean flag intersections,
no emergent states from `isDragging × isPanning × justDropped × wasActor`.

```
idle → dragging → dropped → querying → idle
                ↓ (void drag)
              idle
```

| Phase | Histogram | Track clamp | Amber |
|-------|-----------|-------------|-------|
| `dragging` | projected (live) | unconstrained | ghost |
| `dropped` | projected (held) | unconstrained | ghost |
| `querying` | projected (held) | unconstrained | ghost |
| `idle` (spectator) | retained → morph | constrained | ghost |
| `idle` (settled) | dynamic (server) | constrained | if OOB |

Three mutually exclusive derived booleans: `isActor`, `isSpectator`, `settled`.
Every rendering decision branches from these — nothing else.

**`effectivePhase`** — inline derivation detects `querying && !pending → idle` on the
same render frame. No useEffect, no gap, no amber flash:

```typescript
const effectivePhase: SliderPhase = phase === 'querying' && !pending ? 'idle' : phase;
```

The useEffect that sets `phase = 'idle'` is bookkeeping only. The visual is already
correct on the same render that `pending` goes false.

`isPanning` is a gesture sub-type (cursor style), not a lifecycle phase.

---

### 2. Projection Clipping — The `dragStartRef` Predicate

The projection must be optimistic when expanding into unknown territory, but must NOT
show bars in a confirmed cross-filter void (the amber region).

**The problem:** `activeConMin`/`activeConMax` conflates this slider's own previous range
with cross-filter effects from other sliders. The condition `low < activeConMin` fires
both when dragging into the cross-filter void AND when dragging past your own old
position into territory with real static data. It cannot distinguish these cases.

**The fix:** Check whether amber was visible at **pointerDown** (`dragStartRef.current`),
not whether the current thumb position is past the data extent:

```typescript
const dragStart = dragStartRef.current;
const hadAmberLo = hasConData && dragStart != null && dragStart.lo < activeConMin! - epsilon;
const hadAmberHi = hasConData && dragStart != null && dragStart.hi > activeConMax! + epsilon;
const projConMin = hadAmberLo ? activeConMin : undefined;
const projConMax = hadAmberHi ? activeConMax : undefined;
```

| Scenario | `hadAmber` | Projection |
|----------|-----------|------------|
| No amber at drag start → drag outward | `false` | Fully optimistic — bars grow from static distribution |
| Amber at drag start → drag into void | `true` | Clips at data boundary — no bars in void |
| Static bins zero | n/a | Zero — truly no data anywhere |

The histogram and the amber track tell the same story from their respective languages:
- `staticBins[i] === 0` → truly empty (no data in the unfiltered set)
- `activeConMin`/`activeConMax` → cross-filter constraint (other sliders excluded data)
- `dragStartRef` → disambiguates which applies at the moment of interaction

---

### 3. Compositor-Isolated Histogram Bars

DistributionPlot animates 64 SVG `<rect>` elements. SVG attribute transitions
(`y`, `height`) are main-thread-interpolated — 64 elements × 300ms = the browser
recomputes layout every frame. If the user drags a range slider during that 300ms,
`syncTrack()` writes CSS variables on the same thread. Two animation systems fighting
for the same 16ms budget.

The fix: Replace `y`/`height` attribute animation with `transform: scaleY()` from a
fixed baseline. `transform` is compositor-composited — GPU thread, zero main-thread cost:

```tsx
<rect
  y={0}
  height={plotHeight}
  style={{
    transformOrigin: 'bottom',
    transform: `scaleY(${barHeight / plotHeight})`,
    transition: 'transform 300ms cubic-bezier(0.382, 0, 0.618, 1)',
  }}
/>
```

Histogram morphing runs on the GPU thread. Range slider drag runs on the main thread.
They never collide.

---

### 4. syncTrack — Imperative Geometry, Declarative Appearance

`syncTrack` owns **geometry** at 60fps: `--lo`, `--hi`, `--oob-lo`, `--oob-hi`,
thumb colors. All via direct DOM writes (`el.style.setProperty`), bypassing React
reconciliation.

React owns **appearance** via render: truth track opacity, constrained extent bar
visibility, EditableNumber colors. These change on phase transitions (not every frame).

The `optimistic` parameter to `syncTrack` gates amber:

```typescript
syncTrack(low, high, !settled);  // ghost during any in-flight state
```

Amber only evaluates against constrained bounds when `settled` — fresh server data,
no state transitions in flight. This prevents stale-bound flashes on every phase edge.

---

## What We Learned

The description of the projection took one paragraph. The implementation took three
hours. The cost was paid in two categories:

1. **Boolean flag pile instead of state machine.** Four flags (`isDragging`, `isPanning`,
   `justDropped`, `wasActor`) with different clearing conditions produced emergent states
   that no one could audit. A `useEffect` that cleared `wasActor` when `!pending` would
   self-destruct during the 80ms gap between pointerUp and `START_QUERY` dispatch —
   `!pending && wasActor` evaluated to true before pending ever arrived. Every fix to one
   flag's timing broke another flag's invariant. The state machine eliminated the category.

2. **Wrong predicate for clipping.** `activeConMin` is the data extent from the last query,
   which includes this slider's own range. It cannot answer "is this the cross-filter void
   or unexplored territory?" The answer was already in the codebase: `dragStartRef.current`
   captures the thumb position at pointerDown. Whether amber was visible at that moment —
   not whether the thumb is currently past the data edge — is the correct predicate.

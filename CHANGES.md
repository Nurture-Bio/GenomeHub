# GenomeHub — Change Log

## Unreleased

### JSON file preview — Strand pipeline (embedded, auto-inference)

JSON files now render an interactive analytical table directly on the file detail
page. No server round-trip, no DuckDB, no heap allocation per row.

**Architecture**

The preview is driven by `JsonStrandPreview` (embedded component) backed by
`useJsonStrand(url, 'auto')`. The `'auto'` mode adds a Phase 0 inference step
before the existing Phase 1 scan:

```
Phase 0  inferFields()     — classify every field path, build FieldDef[]
Phase 1  stats scan        — numeric min/max, cardinality sets, intern table,
                             display-width measurements
Phase 2  stream into SAB   — StrandWriter + Atomics backpressure, off-thread
Phase 3  get_constraints   — vectorized bitset filter engine, off-thread
```

All three later phases are unchanged from the DevJsonPage pipeline.

**Schema inference**

`packages/strand/src/inference.ts` (`@strand/inference`) infers a `FieldDef[]`
from the first 500 records:

- Integers, floats, booleans, strings, nested objects, and arrays are all handled
- Numeric type promotion: `i32` widens to `f64` when mixed
- Cardinality gate: string fields with ≤ 100 distinct values and ratio ≤ 0.5
  are classified `utf8_ref` (interned, O(1) bitset-filterable)
- **Low-cardinality guarantee**: fields with ≤ 8 distinct values are *always*
  `utf8_ref` regardless of ratio — a `strand` field with `+`/`-` values is
  always categorical even on a tiny file
- **Boolean reclassification**: pure `bool8` fields are reclassified as
  `utf8_ref`, storing `"true"`/`"false"` as intern handles. This gives them
  the same MultiSelect treatment as any other categorical field instead of
  silently rendering no control

**Cardinality-driven layout**

Phase 1 cardinality data governs both the sidebar filter control and whether a
field appears as a table column. Low-cardinality categoricals add no per-row
information value — they belong in a filter, not a column.

| Cardinality | Sidebar control | Table column |
|---|---|---|
| 1 | `value (constant)` label | Hidden |
| 2–5 | `InlineSelect` — always-visible toggle pills | Hidden |
| 6–100 | `MultiSelect` — popover checkbox list | Shown |
| > 100 | Text search | Shown |

Numeric fields with `min === max` render a `value (constant)` label instead of
a frozen range slider.

**Column auto-sizing**

Phase 1 also measures display-character widths per field (mirroring `fmt()` in
the virtualizer). `JsonStrandPreview` seeds initial column widths from these
measurements rather than per-type defaults.

**Loading states**

The pre-streaming loading screen shows four deterministic steps with lit/unlit
dots: Connecting → Reading → Analyzing → Loading. No indeterminate spinner;
each phase advances one step.

**Worker error handling**

`useJsonStrand` wraps the entire `worker.onmessage` body in a try/catch and
registers `worker.onerror`. Any exception thrown by `buildSchema`,
`computeStrandMap`, `initStrandHeader`, or `new SharedArrayBuffer` surfaces as
an error state instead of silently hanging at the "Analyzing" step forever.

**Metadata layout**

`FileDetailPage` now places the preview table immediately below the filename,
before the metadata block. Metadata (description, size, MD5, organisms, types,
tags, collections, provenance, external links) follows below the data.

---

### `@strand/core` — breaking: `initStrandHeader` meta argument removed

The optional third argument `meta?: unknown` has been removed from
`initStrandHeader`. See [`vendor/strand/CHANGES.md`](vendor/strand/CHANGES.md)
for the full explanation.

The `readonly meta?: unknown` field has also been removed from the `StrandMap`
interface. Any code that passed `{ internTable }` or any other object to
`initStrandHeader` must be updated to pass the intern table through a separate
channel (e.g. the `stream` message, or `new StrandView(sab, internTable)`
directly).

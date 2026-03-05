# Column Header Inline Filters — Design Document

**Date:** 2026-03-04
**Status:** Approved

## Goal

Every column header in the QueryWorkbench table gets an inline text input for filtering. No popovers, no new UI patterns. The type label (VARCHAR, BIGINT, etc.) is removed — users can see the data type from the data itself. The input takes its place.

## Interaction Model

**Sort:** Left-click column name → sort. Shift-click → multi-sort. Unchanged from current TanStack behavior.

**Filter:** Type in the input below the column name. Two behaviors based on column type:

| Column type | Input behavior | State target | Spec type |
|---|---|---|---|
| Text / Category | ILIKE pattern match | `textFilters[col]` via `onTextChange` | `ilike` |
| Numeric | Exact equals via `commitRange(col, [n, n])` | `rangeOverrides[col]` | `between` (low === high) |

No new query operators. Numeric exact match reuses `BETWEEN` with equal bounds.

## Bidirectional State

The header inputs and the ControlCenter share the same state:

- **Text columns:** Header input and ControlCenter text input both read/write `textFilters[col]`. They stay in sync automatically — same controlled value.
- **Numeric columns:** Header input writes `commitRange(col, [n, n])`. The ControlCenter range slider reflects this by snapping both handles to the same value. When the slider is dragged to a proper range (low ≠ high), the header input shows empty — it can't represent a range. When both bounds are equal, it shows the value. One expression, no branches: derive the display value from the data shape.

## Header Cell Layout

**Before:**
```
┌──────────────────────┐
│ ColName    type  ▾   │  ← 28px (ROW_H)
└──────────────────────┘
```

**After:**
```
┌──────────────────────┐
│ ColName           ▾  │
│ [___search________]  │  ← ~2lh
└──────────────────────┘
```

- Type label removed entirely
- Input: `font-mono`, transparent bg, `border border-line`, border turns cyan when value is present
- Input styling matches existing ControlCenter text inputs
- Header height extends to ~1.5–2lh to accommodate

## Column Visibility Toggles

The existing toggle row (below the table chevron) currently has **Numeric** and **Text** buttons. Add a third: **Categories**.

| Toggle | Columns matched |
|---|---|
| Numeric | `isNumericType(col.type)` |
| Text | Non-numeric, cardinality > `DROPDOWN_MAX` (50) |
| Categories | Non-numeric, cardinality ≤ `DROPDOWN_MAX` (50) — includes mono, binary, low-cardinality |

All columns visible by default.

## What Changes

- **Header cell:** Remove type label, add text input, increase height
- **Toggle row:** Add "Categories" button
- **Column visibility:** All columns visible by default (remove cardinality-based hiding)

## What Doesn't Change

- ControlCenter — all rich viz (histograms, range sliders, chips) untouched
- `useFilterState` — same state, same handlers. No new state.
- Query pipeline — no new operators. Numeric `=` reuses `BETWEEN`.
- Sort behavior — left-click sort, shift-click multi-sort, unchanged.

## Dumb Wire

The header inputs are a second location for the same state. No new logic, no new abstractions, no smart behavior. `onTextChange` for text columns, `commitRange` for numerics. Same handlers the ControlCenter uses.

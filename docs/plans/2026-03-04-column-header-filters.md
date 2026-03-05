# Column Header Inline Filters — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every column header in the Data Vault table gets an inline text input for filtering, replacing the type label. Text columns use ILIKE. Numeric columns use exact equals via `commitRange(col, [n, n])`.

**Architecture:** The header is already outside the scroll container (separate `headerRef` div). Each header cell's type label (`{c.type}`) is replaced with a small `<input>`. Text inputs wire to `filters.setTextFilter(name, value)`. Numeric inputs parse to a number and call a new `filters.setRangeExact(name, value)` that writes `[n, n]` directly to `rangeOverrides`. A third "Categories" toggle button is added alongside Numeric/Text. The `tableEligible` filter is loosened so all non-constant columns appear in the table.

**Tech Stack:** React, TanStack Table, useFilterState hook, existing ILIKE/BETWEEN query pipeline.

---

### Task 1: Add `setRangeExact` to useFilterState

The header input for numeric columns needs to write directly to `rangeOverrides` without the drag→commit cycle. Add a one-liner.

**Files:**
- Modify: `packages/client/src/hooks/useFilterState.ts:126-176`

**Step 1: Add `setRangeExact` handler**

After `commitRange` (line 126), before `setTextFilter` (line 128), add:

```typescript
  const setRangeExact = useCallback(
    (name: string, value: number | null) => {
      setRangeOverrides((ro) => {
        if (value === null) {
          const next = { ...ro };
          delete next[name];
          return next;
        }
        return { ...ro, [name]: [value, value] };
      });
    },
    [],
  );
```

**Step 2: Expose it in the return object**

At line 171 (after `commitRange`), add `setRangeExact`:

```typescript
  return {
    specs,
    sortSpecs,
    rangeOverrides,
    dragVisuals,
    selected,
    textFilters,
    sorting,
    setSorting,
    setRangeVisual,
    commitRange,
    setRangeExact,     // ← add
    setTextFilter,
    toggleCategory,
    clearCategory,
    resetFilters,
  };
```

**Step 3: Verify**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: Clean (no consumers yet).

**Step 4: Commit**

```bash
git add packages/client/src/hooks/useFilterState.ts
git commit -m "feat: add setRangeExact to useFilterState for direct numeric override"
```

---

### Task 2: Make all non-constant columns table-eligible

Currently `partitionColumns` excludes low-cardinality categoricals (≤6 distinct) from the table. Remove that filter so all variable columns appear.

**Files:**
- Modify: `packages/client/src/components/QueryWorkbench.tsx:1127-1136`

**Step 1: Simplify `partitionColumns`**

Replace lines 1127–1136:

```typescript
    } else {
      variables.push(c);
      // Low-cardinality categoricals (≤6 distinct) are chip-only — never in the table.
      // Six chips fit across the 280px grid columns. Numeric columns and
      // high-cardinality categoricals are table-eligible.
      const isLowCard = !isNum && card && card.distinct >= 1 && card.distinct <= 6;
      if (!isLowCard) {
        tableEligible.push(c);
      }
    }
```

With:

```typescript
    } else {
      variables.push(c);
      tableEligible.push(c);
    }
```

Every non-constant column is now table-eligible.

**Step 2: Verify**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: Clean.

**Step 3: Commit**

```bash
git add packages/client/src/components/QueryWorkbench.tsx
git commit -m "feat: make all non-constant columns table-eligible"
```

---

### Task 3: Add "Categories" toggle button

The toggle row currently has Numeric and Text. Add Categories for non-numeric columns with cardinality ≤ `DROPDOWN_MAX` (50).

**Files:**
- Modify: `packages/client/src/components/QueryWorkbench.tsx:2107-2109`

**Step 1: Add Categories to the toggle array**

Replace lines 2107–2109:

```typescript
            {[
              { label: 'Numeric', subset: tableEligible.filter((c) => isNumericType(c.type)) },
              { label: 'Text', subset: tableEligible.filter((c) => !isNumericType(c.type)) },
            ].map(({ label, subset }) => {
```

With:

```typescript
            {[
              { label: 'Numeric', subset: tableEligible.filter((c) => isNumericType(c.type)) },
              {
                label: 'Categories',
                subset: tableEligible.filter((c) => {
                  if (isNumericType(c.type)) return false;
                  const card = columnCardinality[c.name];
                  return card && card.distinct >= 1 && card.distinct <= DROPDOWN_MAX;
                }),
              },
              {
                label: 'Text',
                subset: tableEligible.filter((c) => {
                  if (isNumericType(c.type)) return false;
                  const card = columnCardinality[c.name];
                  return !card || card.distinct > DROPDOWN_MAX;
                }),
              },
            ].map(({ label, subset }) => {
```

**Note:** `columnCardinality` must be accessible in this scope. It's already passed to the component — check that it's available where the toggles render. If not, thread it through.

**Step 2: Verify**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: Clean.

**Step 3: Commit**

```bash
git add packages/client/src/components/QueryWorkbench.tsx
git commit -m "feat: add Categories toggle button alongside Numeric and Text"
```

---

### Task 4: Replace type label with filter input in header cells

The main change. Remove `{c.type}` label, add a text input. Text columns → `setTextFilter`. Numeric columns → `setRangeExact`.

**Files:**
- Modify: `packages/client/src/components/QueryWorkbench.tsx:2193-2197` (type label span)

**Step 1: Replace the type label span**

Current code (lines 2193–2197):

```tsx
<span
  style={{ fontSize: 'calc(var(--font-size-xs) - 1px)', opacity: 0.35 }}
>
  {c.type}
</span>
```

Replace with:

```tsx
{isNumericType(c.type) ? (
  <input
    type="text"
    inputMode="numeric"
    className="w-full bg-transparent font-mono text-fg-2 placeholder:text-fg-3 focus:outline-none"
    style={{
      fontSize: 'calc(var(--font-size-xs) - 1px)',
      padding: '1px 0',
      border: 'none',
      borderBottom: '1px solid var(--color-line)',
      ...((() => {
        const r = filters.rangeOverrides[c.name];
        return r && r[0] === r[1] ? { borderBottomColor: 'var(--color-cyan)' } : {};
      })()),
    }}
    placeholder="="
    value={(() => {
      const r = filters.rangeOverrides[c.name];
      return r && r[0] === r[1] ? String(r[0]) : '';
    })()}
    onChange={(e) => {
      const v = e.target.value.trim();
      if (v === '') {
        filters.setRangeExact(c.name, null);
      } else {
        const n = Number(v);
        if (!Number.isNaN(n)) filters.setRangeExact(c.name, n);
      }
    }}
    onClick={(e) => e.stopPropagation()}
  />
) : (
  <input
    type="text"
    className="w-full bg-transparent font-mono text-fg-2 placeholder:text-fg-3 focus:outline-none"
    style={{
      fontSize: 'calc(var(--font-size-xs) - 1px)',
      padding: '1px 0',
      border: 'none',
      borderBottom: `1px solid ${filters.textFilters[c.name]?.trim() ? 'var(--color-cyan)' : 'var(--color-line)'}`,
    }}
    placeholder="search"
    value={filters.textFilters[c.name] ?? ''}
    onChange={(e) => filters.setTextFilter(c.name, e.target.value)}
    onClick={(e) => e.stopPropagation()}
  />
)}
```

**Critical:** `onClick={(e) => e.stopPropagation()}` prevents the input click from triggering the header cell's sort handler.

**Step 2: Ensure `filters` is accessible in the header cell scope**

The header cells render inside an IIFE at ~line 2152. `filters` is the return value of `useFilterState()` — verify it's in scope. It should be, since it's declared in the parent component. If not, thread it through.

**Step 3: Verify**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: Clean.

**Step 4: Visual verification**

Run: `npm run dev -w packages/client`

Open a file preview. Verify:
- Type labels (VARCHAR, BIGINT, etc.) are gone
- Each column header has a small input below the column name
- Typing in a text column input filters rows (ILIKE)
- Typing a number in a numeric column input filters to exact match
- The corresponding ControlCenter slider snaps both handles together when numeric input has a value
- Clearing the input removes the filter
- Clicking the input does NOT trigger sort
- Sort still works when clicking the column name area

**Step 5: Commit**

```bash
git add packages/client/src/components/QueryWorkbench.tsx
git commit -m "feat: replace type labels with inline filter inputs in column headers"
```

---

### Task 5: Bidirectional state — numeric input reflects range slider

When the ControlCenter range slider is dragged, the header input should show the value only when both bounds are equal. This is already handled by the `value` expression in Task 4:

```typescript
value={(() => {
  const r = filters.rangeOverrides[c.name];
  return r && r[0] === r[1] ? String(r[0]) : '';
})()}
```

**Verification only — no code changes expected.**

Run: `npm run dev -w packages/client`

Verify:
- Set a numeric header input to "42" → ControlCenter slider snaps to 42
- Drag the ControlCenter slider to a range (e.g., 100–500) → header input clears to empty
- Drag the slider so both handles meet at same value → header input shows that value
- Clear the header input → range override removed, slider resets to full extent

If all pass, commit is unnecessary (no changes). If any fail, debug and fix.

---

### Task 6: Final build verification

**Step 1: TypeScript check**

Run: `npx tsc --noEmit -p packages/client/tsconfig.json`
Expected: Clean.

**Step 2: Production build**

Run: `npm run build -w packages/client`
Expected: Clean.

**Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve any remaining type or build issues from header filters"
```

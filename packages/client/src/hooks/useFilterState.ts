/**
 * useFilterState — Filter/sort state and mutation handlers.
 *
 * Owns: rangeOverrides, dragVisuals, selected, textFilters, sorting state.
 * Returns: derived FilterSpec[] and SortSpec[], plus handlers for the UI.
 *
 * Handler naming convention: intent, not gesture.
 *   setRangeVisual — transient paint (drag in progress, never persisted)
 *   commitRange    — durable write to the committed ledger
 *   setRangeExact  — durable write (exact-match numeric, bypasses drag)
 *   setTextFilter  — durable write
 *   toggleCategory — durable write
 *   clearCategory  — durable write
 *   resetFilters   — clear the entire ledger
 *
 * @module
 */

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { SortingState } from '@tanstack/react-table';
import type { FilterSpec, SortSpec } from '@genome-hub/shared';
import type { ColumnStats } from './useFileQuery';

export interface FilterState {
  // Specs — what the engine consumes
  specs: FilterSpec[];
  sortSpecs: SortSpec[];

  // Levers — raw state for the UI
  rangeOverrides: Record<string, [number, number]>;
  dragVisuals: Record<string, [number, number]>;
  selected: Record<string, Set<string>>;
  textFilters: Record<string, string>;
  sorting: SortingState;
  setSorting: Dispatch<SetStateAction<SortingState>>;

  // Mutators — intent, not gesture
  setRangeVisual: (name: string, lo: number, hi: number) => void;
  commitRange: (name: string) => void;
  setRangeExact: (name: string, value: number | null) => void;
  setTextFilter: (name: string, value: string) => void;
  toggleCategory: (name: string, value: string) => void;
  clearCategory: (name: string) => void;
  resetFilters: () => void;
}

export function useFilterState(columnStats: Record<string, ColumnStats>): FilterState {
  const [rangeOverrides, setRangeOverrides] = useState<Record<string, [number, number]>>({});
  const [dragVisuals, setDragVisuals] = useState<Record<string, [number, number]>>({});
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [textFilters, setTextFilters] = useState<Record<string, string>>({});
  const [sorting, setSorting] = useState<SortingState>([]);

  // ── Pure Derivation — the Single Source of Truth ──
  const sortSpecs: SortSpec[] = useMemo(
    () =>
      sorting.map((s) => ({
        column: s.id,
        direction: s.desc ? ('desc' as const) : ('asc' as const),
      })),
    [sorting],
  );

  const specs: FilterSpec[] = useMemo(() => {
    const result: FilterSpec[] = [];
    for (const [name, [lo, hi]] of Object.entries(rangeOverrides)) {
      result.push({ column: name, op: { type: 'between', low: lo, high: hi } });
    }
    for (const [name, set] of Object.entries(selected)) {
      if (set.size === 0) continue;
      result.push({ column: name, op: { type: 'in', values: [...set] } });
    }
    for (const [name, text] of Object.entries(textFilters)) {
      if (!text.trim()) continue;
      result.push({ column: name, op: { type: 'ilike', pattern: text.trim() } });
    }
    return result;
  }, [rangeOverrides, selected, textFilters]);

  // ── Mutators ───────────────────────────────────────────────────────────────

  // rAF throttle: batch all drag events within one animation frame into
  // a single setState. Only touches dragVisuals — never the committed ledger.
  const rafRef = useRef<number | null>(null);
  const pendingDrag = useRef<{ name: string; lo: number; hi: number } | null>(null);

  const setRangeVisual = useCallback((name: string, lo: number, hi: number) => {
    pendingDrag.current = { name, lo, hi };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingDrag.current;
        if (p) setDragVisuals((prev) => ({ ...prev, [p.name]: [p.lo, p.hi] }));
      });
    }
  }, []);

  const commitRange = useCallback((name: string) => {
    // Commit the drag visual to the true ledger
    setDragVisuals((prev) => {
      const visual = prev[name];
      if (visual) {
        // Write final value to the committed ledger
        setRangeOverrides((ro) => {
          const stats = columnStats[name];
          // Clean up identity ranges — if dragged back to [min, max], remove the override
          if (stats && visual[0] <= stats.min && visual[1] >= stats.max) {
            const next = { ...ro };
            delete next[name];
            return next;
          }
          return { ...ro, [name]: visual };
        });
        // Clear the visual so it falls back to the true ledger
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return prev;
    });
  }, [columnStats]);

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

  const setTextFilter = useCallback((name: string, value: string) => {
    setTextFilters((prev) => ({ ...prev, [name]: value }));
  }, []);

  const toggleCategory = useCallback((name: string, value: string) => {
    setSelected((prev) => {
      const set = new Set(prev[name] ?? []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      if (set.size === 0) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return { ...prev, [name]: set };
    });
  }, []);

  const clearCategory = useCallback((name: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setRangeOverrides({});
    setDragVisuals({});
    setSelected({});
    setTextFilters({});
  }, []);

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
    setRangeExact,
    setTextFilter,
    toggleCategory,
    clearCategory,
    resetFilters,
  };
}

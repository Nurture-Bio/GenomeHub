import { useState, useMemo, type Dispatch, type SetStateAction } from 'react';

/**
 * useDerivedState — fuses useState + useMemo into one hook.
 *
 * Manages a local patch/overrides value and derives the final result
 * by merging the patch with computed defaults. Replaces the
 * useEffect + setState pattern that causes nested-update re-renders.
 *
 * @param compute  Receives the current patch, returns the derived value.
 *                 Must be pure — only depends on its argument + the values
 *                 captured in `deps`.
 * @param deps     Dependencies for the base data (patch is always included).
 * @returns        [derivedValue, setPatch]
 */
export function useDerivedState<TResult, TPatch>(
  compute: (patch: TPatch) => TResult,
  deps: readonly unknown[],
  initialPatch: TPatch | (() => TPatch),
): [TResult, Dispatch<SetStateAction<TPatch>>] {
  const [patch, setPatch] = useState<TPatch>(initialPatch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const derived = useMemo(() => compute(patch), [...deps, patch]);
  return [derived, setPatch];
}

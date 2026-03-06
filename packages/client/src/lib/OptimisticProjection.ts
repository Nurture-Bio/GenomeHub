/**
 * OptimisticProjection — contract for instant local estimates.
 *
 * Given static (unfiltered) reference data and the user's current filter
 * parameters, compute a synchronous local approximation. The server result
 * arrives later; the spring corrects silently.
 *
 * Resolution pattern (consumer's responsibility, not part of the interface):
 *   serverData ?? projected ?? staticData
 *
 * TStatic: unfiltered reference data shape (e.g. number[] for histogram bins)
 * TParams: filter/constraint parameters (e.g. { lo, hi, min, max, conMin?, conMax? })
 * TOutput: what the visualization renders (e.g. number[] for histogram bars)
 */
export interface OptimisticProjection<TStatic, TParams, TOutput> {
  /** Must be pure, fast, synchronous — called on every drag frame (~60fps). */
  project(staticData: TStatic, params: TParams): TOutput;
}

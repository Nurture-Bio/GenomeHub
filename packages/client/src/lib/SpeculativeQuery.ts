/**
 * SpeculativeQuery — async preflight that fires before the debounced full query.
 *
 * The consumer fires `fire()` immediately on filter change. If the preflight
 * returns before the full query fires and `canPromote()` returns true,
 * the preflight result is merged into the snapshot — the user sees count + stats
 * before the full query would have even started.
 *
 * TParams: query parameters (e.g. FilterSpec[] + SortSpec[])
 * TOutput: partial result (e.g. { count, stats })
 */
export interface SpeculativeQuery<TParams, TOutput> {
  /** Fire a lightweight speculative query. Caller manages abort via signal. */
  fire(params: TParams, signal: AbortSignal): Promise<TOutput>;
  /** Can the preflight result be promoted? True if params haven't diverged. */
  canPromote(preflightParams: TParams, commitParams: TParams): boolean;
}

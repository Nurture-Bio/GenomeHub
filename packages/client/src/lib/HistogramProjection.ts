/**
 * HistogramProjection — optimistic local estimate for histogram bins.
 *
 * Zeroes bins outside the selected range, intersects with the constrained
 * data extent from cross-column filters, and rescales the local peak to
 * match the global peak. Valid for the active column only — cross-column
 * effects require the server. Replaced by the real constrained histogram
 * when it arrives.
 */

import type { OptimisticProjection } from './OptimisticProjection';

export interface HistogramParams {
  lo: number;
  hi: number;
  min: number;
  max: number;
  /** Constrained data extent — cross-filtered boundaries from other columns. */
  conMin?: number;
  conMax?: number;
}

export const histogramProjection: OptimisticProjection<number[], HistogramParams, number[]> = {
  project(staticBins, params) {
    const { lo, hi, min, max, conMin, conMax } = params;
    const n = staticBins.length;
    const range = max - min || 1;
    const toBin = (v: number) =>
      Math.max(0, Math.min(n - 1, Math.floor(((v - min) / range) * n)));
    const binLo = toBin(lo);
    const binHi = toBin(hi);

    // Intersect the selected range with the constrained data extent.
    // Bins outside [conMin, conMax] are OOB — the cross-filtered query will return
    // 0 for them, so including them in the projection would inflate the estimate.
    const conBinLo = conMin !== undefined ? toBin(conMin) : 0;
    const conBinHi = conMax !== undefined ? toBin(conMax) : n - 1;
    const effectiveLo = Math.max(binLo, conBinLo);
    const effectiveHi = Math.min(binHi, conBinHi);

    // Pass 1: find local maximum within the effective (in-bounds) range
    let localMax = 0;
    for (let i = effectiveLo; i <= effectiveHi; i++) {
      if (staticBins[i] > localMax) localMax = staticBins[i];
    }
    if (localMax === 0) return new Array<number>(n).fill(0);
    // Pass 2: rescale visible bins so local peak = global peak of static distribution
    const globalMax = Math.max(...staticBins, 1);
    const projected = new Array<number>(n).fill(0);
    for (let i = effectiveLo; i <= effectiveHi; i++) {
      projected[i] = (staticBins[i] / localMax) * globalMax;
    }
    return projected;
  },
};

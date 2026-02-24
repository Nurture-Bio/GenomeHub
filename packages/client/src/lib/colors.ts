/**
 * Canonical hash-based color system.
 *
 * One function. One hash. One color model. Everything in the app that
 * needs a deterministic per-label color imports from here.
 *
 * Algorithm:
 *   1. FNV-1a accumulation — good distribution for short strings
 *   2. Murmur3 32-bit finalizer — avalanche mixing so similar strings
 *      (e.g. "gff" vs "gtf" vs "gbk") land far apart on the hue wheel
 *   3. Scale to 0–360 → hue angle
 *
 * Color model: OKLCH for perceptually uniform brightness across hues.
 *   bg    = dark, low-chroma tint  (suitable for dark-mode pill backgrounds)
 *   color = mid-brightness, high-chroma  (legible text on bg)
 */

export interface HashColor {
  bg:    string;   // e.g. oklch(0.20 0.05 147)
  color: string;   // e.g. oklch(0.75 0.18 147)
}

function hashHue(s: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Murmur3 finalizer
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xFFFFFFFF) * 360;
}

/** Deterministic color pair for any string label. */
export function hashColor(label: string): HashColor {
  const hue = hashHue(label);
  return {
    bg:    `oklch(0.20 0.05 ${hue})`,
    color: `oklch(0.75 0.18 ${hue})`,
  };
}

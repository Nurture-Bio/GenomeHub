/**
 * Canonical hash-based color system.
 *
 * One function. One hash. One color model. Everything in the app that
 * needs a deterministic per-label color imports from here.
 *
 * Algorithm:
 *   1. Polynomial accumulation  (h = 31h + c) — fast, portable
 *   2. Knuth multiplicative scramble (× 2654435761 = ⌊2³²/φ⌋)
 *      Maps adjacent raw hashes to distant hue angles, so visually similar
 *      strings (e.g. "gtf" vs "gbff") land far apart on the wheel.
 *   3. Modulo 360 → HSL hue angle
 *
 * Color model: OKLCH for perceptually uniform brightness across hues.
 *   bg    = dark, low-chroma tint  (suitable for dark-mode pill backgrounds)
 *   color = mid-brightness, high-chroma  (legible text on bg)
 */

export interface HashColor {
  bg:    string;   // e.g. oklch(0.22 0.05 147)
  color: string;   // e.g. oklch(0.72 0.18 147)
}

function knuthHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  h = Math.imul(h >>> 0, 2654435761) >>> 0;
  return h % 360;
}

/** Deterministic color pair for any string label. */
export function hashColor(label: string): HashColor {
  const hue = knuthHue(label);
  return {
    bg:    `oklch(0.20 0.05 ${hue})`,
    color: `oklch(0.75 0.18 ${hue})`,
  };
}

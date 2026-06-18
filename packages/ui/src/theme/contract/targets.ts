/**
 * Generation constants: APCA target curves, elevation positions, and state ΔL.
 *
 * APCA Lc values are signed:
 *   light mode: text is darker than bg → negative Lc (colorjs contrastAPCA convention)
 *   dark mode:  text is lighter than bg → positive Lc
 *
 * Target curves are calibrated from the current Radix Color P3 neutral + jade
 * scales so generated ramps stay visually close to the existing palette:
 *
 *   Light neutral measured:  0, 0, 0, -11, -16, -21, -28, -39, -64, -69, -83, -104
 *   Dark  neutral measured:  0,  0,  0,  0,  0,  0, 12, 22, 28, 34, 63, 95
 *
 * Steps 1–3 are near-background and intentionally have Lc ≈ 0 (fills, not text).
 * Steps 11–12 anchor the text contrast targets (~60 / ~95 Lc).
 */

import type { Polarity } from './roles.js';

export type ApcaTargets = readonly [
  number, // step 1  — background, Lc≈0
  number, // step 2  — subtle bg
  number, // step 3  — component bg
  number, // step 4  — hover state
  number, // step 5  — active/selected
  number, // step 6  — subtle border
  number, // step 7  — ui border
  number, // step 8  — strong border / disabled text
  number, // step 9  — solid fill (brand color)
  number, // step 10 — hovered solid
  number, // step 11 — accessible text (lo-contrast)
  number, // step 12 — high-contrast text
];

/**
 * APCA Lc target per step for each polarity.
 * Negative = text darker than background (light mode convention).
 * Positive = text lighter than background (dark mode convention).
 */
export const APCA_TARGETS: Record<Polarity, ApcaTargets> = {
  // Light: text is darker than white bg → negative Lc
  light: [0, -2, -5, -11, -16, -22, -28, -40, -64, -69, -84, -104],
  // Dark: text is lighter than near-black bg → positive Lc
  dark: [0, 2, 5, 7, 10, 14, 22, 32, 45, 52, 65, 92],
};

/**
 * Chroma curve: relative chroma multiplier per step (0..1 scale applied to chromaPeak).
 * Peaks at step 9 (solid fill); falls toward steps 1–3 (backgrounds) and 12 (text).
 * Calibrated so that neutral (chroma≈0) and vivid accents both read naturally.
 */
export const CHROMA_CURVE: readonly number[] = [
  0.05, // 1  — near-zero chroma (background)
  0.08, // 2
  0.14, // 3
  0.22, // 4
  0.34, // 5
  0.5, // 6
  0.68, // 7
  0.82, // 8
  1.0, // 9  — solid, full chroma peak
  0.96, // 10
  0.72, // 11 — text (slightly reduced for readability)
  0.45, // 12 — high-contrast text (further reduced)
];

/**
 * OKLab L shift applied to derive hover and selected state layers from a surface base.
 * Positive = lighter (dark mode convention); direction is inverted per polarity in generate/surfaces.ts.
 */
export const STATE_LAYER_DELTA = {
  hover: 0.04,
  selected: 0.08,
} as const;

/**
 * Fractional positions on the neutral L-curve for each surface elevation.
 * 0 = step 1 lightness; 1 = step 12 lightness.
 * Chosen so elevations are perceptually distinct without being jarring.
 */
export const ELEVATION_POSITIONS = {
  sunken: 0.18, // slightly deeper than base
  base: 0.08, // canvas floor
  raised: 0.12, // panels
  overlay: 0.2, // cards / inset areas
  floating: 0.27, // popovers, dropdowns
} as const;

/**
 * Minimum APCA |Lc| for syntax token colors vs the code background.
 * Comment tokens get a looser target — intentionally lower contrast.
 */
export const SYNTAX_MIN_APCA: Record<string, number> = {
  comment: 30,
  default: 45,
};

/** Minimum perceptual hue separation (ΔE in OKLCH approximation) between syntax roles. */
export const SYNTAX_MIN_DELTA_H = 15;

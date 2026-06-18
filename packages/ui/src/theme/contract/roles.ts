/**
 * Stable vocabulary for the theme generation system.
 *
 * ScaleName  — the palette scales every theme must supply.
 * Step       — 1-based index into a 12-step scale.
 * SyntaxRole — abstract syntax categories mapped to TextMate scopes.
 *
 * Scales are named by HUE IDENTITY (green, red, amber, …), not by semantic
 * role (success, danger, …). Meaning is assigned exactly once, in
 * semantic-template.ts (e.g. success → green, merged → purple). This keeps the
 * palette free of semantics and lets new colors be added without inventing a
 * role name. `neutral` (gray) and `accent` (the swappable brand color) are the
 * two role-level scales that stay.
 */

export type ScaleName =
  | 'neutral'
  | 'accent'
  | 'green'
  | 'red'
  | 'amber'
  | 'blue'
  | 'orange'
  | 'purple';

/** Hue-named scales that carry no fixed semantic role. */
export type HueScaleName = Exclude<ScaleName, 'neutral' | 'accent'>;

/** Canonical ordered list of all palette scales. Shared between the generator and stories. */
export const SCALE_NAMES = [
  'neutral',
  'accent',
  'green',
  'red',
  'amber',
  'blue',
  'orange',
  'purple',
] as const satisfies readonly ScaleName[];

/** Steps 1–12 for iteration. */
export const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type SyntaxRole =
  | 'comment'
  | 'keyword'
  | 'string'
  | 'number'
  | 'function'
  | 'type'
  | 'variable'
  | 'property'
  | 'operator'
  | 'tag'
  | 'attribute'
  | 'regexp';

/** Polarity of a theme — determines APCA target direction and L-curve orientation. */
export type Polarity = 'light' | 'dark';

/**
 * A fully resolved 12-step color scale.
 * steps[0] is step 1 (background family), steps[11] is step 12 (text family).
 * contrast is the accessible text color for use on the solid (step 9) background.
 */
export type Ramp = {
  steps: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  contrast: string;
  /**
   * When true, step 9 (solid) is light enough that black text is more readable
   * than white text — the gamut-cusp fix for yellow/amber-like hues.
   */
  darkForeground?: boolean;
};

export type Scales = Record<ScaleName, Ramp>;

/** Resolved surface elevation set. */
export type SurfaceLevel = {
  base: string;
  hover: string;
  selected: string;
};

export type Surfaces = {
  sunken: SurfaceLevel;
  base: SurfaceLevel;
  raised: SurfaceLevel;
  overlay: SurfaceLevel;
  floating: SurfaceLevel;
};

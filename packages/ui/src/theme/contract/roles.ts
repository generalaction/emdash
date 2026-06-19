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

/** Named elevation levels, ordered from darkest to lightest. */
export type SurfaceLevelName =
  | 'sunken'
  | 'base'
  | 'base-emphasis'
  | 'elevated'
  | 'elevated-emphasis';

/** Canonical ordered list of all surface levels (darkest → lightest). */
export const SURFACE_LEVELS = [
  'sunken',
  'base',
  'base-emphasis',
  'elevated',
  'elevated-emphasis',
] as const satisfies readonly SurfaceLevelName[];

/**
 * Semantic surface roles that are generated like elevation levels (from neutral
 * L targets) but intentionally do NOT belong to the darkest→lightest ladder.
 *
 * `paper` is the primary content/tab background: white-ish in light mode (like
 * `elevated`) but flat with `base` in dark mode. Because its light/dark mappings
 * are decoupled, it is kept out of SURFACE_LEVELS so the elevation ladder (and
 * the swatch grids that visualize it) stays an honest monotonic ramp.
 */
export type SurfaceRoleName = 'paper';

/** Canonical ordered list of semantic surface roles. */
export const SURFACE_ROLES = ['paper'] as const satisfies readonly SurfaceRoleName[];

/** Any scope that produces a generated neutral surface (elevation level or role). */
export type SurfaceScopeName = SurfaceLevelName | SurfaceRoleName;

/** Levels + roles together, for generators and resolvers that emit all of them. */
export const SURFACE_SCOPES = [...SURFACE_LEVELS, ...SURFACE_ROLES] as const;

export type Surfaces = Record<SurfaceScopeName, SurfaceLevel>;

// ── Status surface names ───────────────────────────────────────────────────────

/** Named status surfaces that produce tinted colored "rooms". */
export type SurfaceStatusName = 'destructive' | 'warning' | 'info';

/** Canonical ordered list of status surface names. */
export const SURFACE_STATUSES = [
  'destructive',
  'warning',
  'info',
] as const satisfies readonly SurfaceStatusName[];

/** Maps each status surface to the palette scale it derives its colors from. */
export const STATUS_SCALE: Record<SurfaceStatusName, ScaleName> = {
  destructive: 'red',
  warning: 'amber',
  info: 'blue',
};

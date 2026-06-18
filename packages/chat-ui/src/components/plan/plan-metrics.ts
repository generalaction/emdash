/**
 * Geometry constants for plan rows.
 *
 * Shared between plan.def.tsx (measure), measure.ts (pure height), and
 * Plan.tsx (render slots) so there is a single source of truth for these values.
 */

/** Vertical padding (px) inside the expanded entry list, applied top and bottom. */
export const PLAN_PAD_Y = 6;

/** Width (px) of the fixed status-glyph gutter to the left of each entry body. */
export const PLAN_ENTRY_INDENT = 20;

/** Vertical gap (px) between consecutive plan entries. */
export const PLAN_ENTRY_GAP = 4;

/** Border width (px) of the plan card. Matches the rendered `border` class. */
export const PLAN_BORDER = 1;

/** Horizontal padding (px) inside the plan card border, each side. */
export const PLAN_PAD_X = 12;

/** Vertical padding (px) inside the plan card border, top and bottom. */
export const PLAN_OUTER_PAD_Y = 6;

/**
 * Maximum height (px) of the collapsed preview window. When collapsed, the
 * entry list is clipped to this height and (while streaming) auto-scrolls to
 * the bottom so newly-added tasks stay visible.
 */
export const PLAN_WINDOW_H = 96;

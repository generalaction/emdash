/**
 * Table metrics — geometry constants for formula-measured tables.
 *
 * TABLE_ROW_H must match the CSS: line-height(20) + padding-top(6) + padding-bottom(6) = 32.
 * A parity test in spec.test.ts enforces this invariant.
 */

/** Height of a single table row in px (header or data). Must match CSS. */
export const TABLE_ROW_H = 32;

/** Additional px for the outermost border that border-collapse doesn't absorb. */
export const TABLE_BORDER = 1;

/** Minimum column width in px before horizontal scroll is preferred over squeezing. */
export const TABLE_MIN_COL_W = 80;

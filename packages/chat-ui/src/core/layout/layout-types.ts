/**
 * Geometry types produced by the projected layout engine.
 *
 * These are plain data structures (no React, no MobX).
 * `layoutMessage()` produces a `MessageLayout` that is used for BOTH
 * the virtualizer height and the absolute-positioned DOM projection —
 * measure/render parity is structural.
 */

/** A single fragment on a line: the text to render and its x offset. */
export type FragmentLayout = {
  text: string;
  /** X offset in px from the block's left edge. */
  x: number;
  /** Index into the original `InlineRun[]` array — used to determine styling. */
  runIndex: number;
};

/** A single wrapped line inside a prose block. */
export type LineLayout = {
  /** Y offset in px from the block's top edge. */
  top: number;
  /** Left indent in px (for list items, blockquotes). */
  left: number;
  fragments: FragmentLayout[];
  /**
   * X offset of the right edge of the last fragment, in px from the block's
   * left edge. Equal to `left + endX` gives the absolute cursor insertion point
   * for streaming indicators.
   */
  endX: number;
};

/** Optional absolute bullet marker (list items). */
export type BulletLayout = {
  x: number;
  top: number;
  char: string;
};

/** Prose block with pre-computed line/fragment geometry. */
export type ProseLaidOut = {
  kind: 'prose';
  id: string;
  top: number;
  height: number;
  /**
   * Widest line right-edge in px (textLeft + occupiedWidth of all fragments).
   * Used by MessageLayout to compute the user bubble hug-width.
   */
  contentWidth: number;
  /**
   * Per-line band height in px (variant line-height). The renderer sets this as
   * the line element's height so `.pf { top: 50% }` centers text within the band.
   */
  lineHeight: number;
  lines: LineLayout[];
  bullet?: BulletLayout;
  /** True if a left-side quote rail should be drawn. */
  quoteRail?: boolean;
};

/** Code block with pre-positioned source lines. */
export type CodeLaidOut = {
  kind: 'code';
  id: string;
  top: number;
  height: number;
  /** Full effective width — code blocks always fill their allocated area. */
  contentWidth: number;
  lines: { top: number; text: string }[];
  lang?: string;
};

/** Island block: a fixed or DOM-measured box. */
export type IslandLaidOut = {
  kind: 'island';
  id: string;
  top: number;
  height: number;
  /** Full effective width — islands always fill their allocated area. */
  contentWidth: number;
  islandType: string;
  raw: string;
};

/** Table block: formula-measured, single-line truncated cells. */
export type TableLaidOut = {
  kind: 'table';
  id: string;
  top: number;
  height: number;
  contentWidth: number;
  /** Width of each column in px (equal distribution, floored at TABLE_MIN_COL_W). */
  colWidths: number[];
  /** Total table width = colWidths.length * colW; may exceed contentWidth (triggers scroll). */
  tableWidth: number;
  header: string[];
  rows: string[][];
};

export type BlockLaidOut = ProseLaidOut | CodeLaidOut | IslandLaidOut | TableLaidOut;

/** Full layout for a single ChatMessage virtualizer row. */
export type MessageLayout = {
  /** Total pixel height of the row (bubble padding + block heights + gaps). */
  height: number;
  /**
   * Maximum content width across all blocks.
   * For user messages, the bubble is sized to this + 2*BUBBLE_PAD_X so it
   * hugs the widest line of text.
   */
  width: number;
  blocks: BlockLaidOut[];
};

/**
 * Standalone terminal dimension measurement utility.
 *
 * Extracted from FitAddon.proposeDimensions() but decoupled from any specific
 * terminal instance — accepts a container element and cell metrics directly.
 * This lets callers measure any DOM element (e.g. PaneSizingProvider's
 * container) without first mounting a terminal inside it.
 */

const MINIMUM_COLS = 2;
const MINIMUM_ROWS = 1;

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

/**
 * Compute terminal cols/rows from a container element's pixel dimensions and
 * the terminal's CSS cell size.
 *
 * @param container  The element whose CSS width/height defines the available area.
 * @param cellWidth  Terminal cell width in CSS pixels (terminal.dimensions.css.cell.width).
 * @param cellHeight Terminal cell height in CSS pixels (terminal.dimensions.css.cell.height).
 * @param scrollbarWidth Width in pixels to subtract for the scrollbar (0 when scrollback=0).
 */
export function measureDimensions(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
  scrollbarWidth = 0
): TerminalDimensions | null {
  if (cellWidth === 0 || cellHeight === 0) return null;
  const style = window.getComputedStyle(container);
  const width = Math.max(0, Number.parseInt(style.width));
  const height = Number.parseInt(style.height);
  if (Number.isNaN(width) || Number.isNaN(height) || height === 0) return null;
  return {
    cols: Math.max(MINIMUM_COLS, Math.floor((width - scrollbarWidth) / cellWidth)),
    rows: Math.max(MINIMUM_ROWS, Math.floor(height / cellHeight)),
  };
}

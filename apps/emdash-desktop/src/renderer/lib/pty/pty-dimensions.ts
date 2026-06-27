/**
 * Standalone terminal dimension measurement utility.
 *
 * Extracted from FitAddon.proposeDimensions() but decoupled from any specific
 * terminal instance — accepts a container element and cell metrics directly.
 * This lets callers measure any DOM element (e.g. the PaneDimensionProvider's
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

// ── Standalone cell metrics ────────────────────────────────────────────────────

interface CellMetricsCacheEntry {
  fontFamily: string;
  fontSize: number;
  dpr: number;
  width: number;
  height: number;
}

let _cellCache: CellMetricsCacheEntry | null = null;

/**
 * Measure terminal cell width and height from font settings alone, without a
 * mounted xterm instance. Uses a canvas to replicate xterm's own font
 * measurement, caching the result by (fontFamily, fontSize, devicePixelRatio).
 *
 * Returns null when called outside a browser context (e.g. SSR/tests) or when
 * canvas is unavailable. Used by the per-pane resize controller to drive PTY
 * resizes even when no terminal is mounted in a pane.
 */
export function measureTerminalCell(
  fontFamily: string,
  fontSize: number
): { width: number; height: number } | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;

  const dpr = window.devicePixelRatio ?? 1;
  if (
    _cellCache &&
    _cellCache.fontFamily === fontFamily &&
    _cellCache.fontSize === fontSize &&
    _cellCache.dpr === dpr
  ) {
    return { width: _cellCache.width, height: _cellCache.height };
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.font = `${fontSize}px ${fontFamily}`;

    // Width: measure 'W' (widest common ASCII character), matching xterm's approach.
    const cellWidth = Math.ceil(ctx.measureText('W').width);

    // Height: use bounding box metrics like xterm's CanvasRenderer does.
    // Fall back to fontSize when actualBoundingBox metrics are unavailable.
    const mMetrics = ctx.measureText('M');
    const charHeight =
      typeof mMetrics.actualBoundingBoxAscent === 'number' &&
      typeof mMetrics.actualBoundingBoxDescent === 'number' &&
      mMetrics.actualBoundingBoxAscent + mMetrics.actualBoundingBoxDescent > 0
        ? mMetrics.actualBoundingBoxAscent + mMetrics.actualBoundingBoxDescent
        : fontSize;
    const cellHeight = Math.ceil(charHeight);

    if (cellWidth === 0 || cellHeight === 0) return null;

    _cellCache = { fontFamily, fontSize, dpr, width: cellWidth, height: cellHeight };
    return { width: cellWidth, height: cellHeight };
  } catch {
    return null;
  }
}

/** Drop the standalone cell metrics cache (e.g. after a font or DPR change). */
export function invalidateCellMetricsCache(): void {
  _cellCache = null;
}

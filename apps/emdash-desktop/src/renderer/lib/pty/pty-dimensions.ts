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
 * Pure grid-dimension calculation: convert pixel dimensions → terminal cols/rows.
 *
 * `paddingPx` is the uniform padding (each side) that has not yet been excluded
 * from widthPx/heightPx. Pass 0 when the caller measures an already-padded
 * element (e.g. measureDimensions measures ownedContainer whose getComputedStyle
 * returns the content-box size, so padding is already excluded).
 */
export function computeGridDimensions({
  widthPx,
  heightPx,
  cellWidth,
  cellHeight,
  paddingPx = 0,
  scrollbarWidth = 0,
}: {
  widthPx: number;
  heightPx: number;
  cellWidth: number;
  cellHeight: number;
  paddingPx?: number;
  scrollbarWidth?: number;
}): TerminalDimensions | null {
  if (cellWidth === 0 || cellHeight === 0) return null;
  const availW = widthPx - scrollbarWidth - 2 * paddingPx;
  const availH = heightPx - 2 * paddingPx;
  if (Number.isNaN(availW) || Number.isNaN(availH) || availH <= 0) return null;
  return {
    cols: Math.max(MINIMUM_COLS, Math.floor(availW / cellWidth)),
    rows: Math.max(MINIMUM_ROWS, Math.floor(availH / cellHeight)),
  };
}

/**
 * Compute terminal cols/rows from a container element's pixel dimensions and
 * the terminal's CSS cell size.
 *
 * @param container  The element whose CSS width/height defines the available area.
 * @param cellWidth  Terminal cell width in CSS pixels (terminal.dimensions.css.cell.width).
 * @param cellHeight Terminal cell height in CSS pixels (terminal.dimensions.css.cell.height).
 * @param scrollbarWidth Width in pixels to subtract for the scrollbar (0 when scrollback=0).
 *
 * NOTE: pass paddingPx: 0 (the default) here because getComputedStyle returns the
 * content-box size even under box-sizing: border-box, so padding is already excluded.
 * Callers that measure an unpadded ancestor must use computeGridDimensions directly
 * and supply paddingPx explicitly.
 */
export function measureDimensions(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
  scrollbarWidth = 0,
  paddingPx = 0
): TerminalDimensions | null {
  const style = window.getComputedStyle(container);
  const widthPx = Math.max(0, Number.parseInt(style.width));
  const heightPx = Number.parseInt(style.height);
  if (Number.isNaN(widthPx) || Number.isNaN(heightPx)) return null;
  return computeGridDimensions({
    widthPx,
    heightPx,
    cellWidth,
    cellHeight,
    scrollbarWidth,
    paddingPx,
  });
}

// ── Standalone cell metrics ────────────────────────────────────────────────────

interface CellMetricsCacheEntry {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  dpr: number;
  width: number;
  height: number;
}

let _cellCache: CellMetricsCacheEntry | null = null;

/**
 * Measure terminal cell width and height from font settings alone, without a
 * mounted xterm instance. Uses a canvas to replicate xterm's own font
 * measurement, caching the result by (fontFamily, fontSize, lineHeight, letterSpacing, dpr).
 *
 * `lineHeight` and `letterSpacing` must match the xterm Terminal options so the
 * seed matches xterm's real row pitch (device.cell.height = floor(charHeight * lineHeight),
 * device.cell.width = charWidth + round(letterSpacing)).
 *
 * Returns null when called outside a browser context (e.g. SSR/tests) or when
 * canvas is unavailable. Used by the per-pane resize controller to drive PTY
 * resizes even when no terminal is mounted in a pane.
 */
export function measureTerminalCell(
  fontFamily: string,
  fontSize: number,
  lineHeight = 1,
  letterSpacing = 0
): { width: number; height: number } | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;

  const dpr = window.devicePixelRatio ?? 1;
  if (
    _cellCache &&
    _cellCache.fontFamily === fontFamily &&
    _cellCache.fontSize === fontSize &&
    _cellCache.lineHeight === lineHeight &&
    _cellCache.letterSpacing === letterSpacing &&
    _cellCache.dpr === dpr
  ) {
    return { width: _cellCache.width, height: _cellCache.height };
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.font = `${fontSize}px ${fontFamily}`;

    // Width: measure 'W' (widest common ASCII character) + letterSpacing,
    // matching xterm's cell.width = charWidth + round(letterSpacing).
    const cellWidth = Math.ceil(ctx.measureText('W').width + letterSpacing);

    // Height: use bounding box metrics like xterm's CanvasRenderer does, then
    // apply lineHeight to match xterm's cell.height = floor(charHeight * lineHeight).
    const mMetrics = ctx.measureText('M');
    const charHeight =
      typeof mMetrics.actualBoundingBoxAscent === 'number' &&
      typeof mMetrics.actualBoundingBoxDescent === 'number' &&
      mMetrics.actualBoundingBoxAscent + mMetrics.actualBoundingBoxDescent > 0
        ? mMetrics.actualBoundingBoxAscent + mMetrics.actualBoundingBoxDescent
        : fontSize;
    const cellHeight = Math.ceil(charHeight * lineHeight);

    if (cellWidth === 0 || cellHeight === 0) return null;

    _cellCache = {
      fontFamily,
      fontSize,
      lineHeight,
      letterSpacing,
      dpr,
      width: cellWidth,
      height: cellHeight,
    };
    return { width: cellWidth, height: cellHeight };
  } catch {
    return null;
  }
}

/** Drop the standalone cell metrics cache (e.g. after a font or DPR change). */
export function invalidateCellMetricsCache(): void {
  _cellCache = null;
}

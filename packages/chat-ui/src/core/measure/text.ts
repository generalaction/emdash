/**
 * Theme-threaded text measurement utilities.
 *
 * Wraps the `pretext`-based prose layout (`components/prose/layout.ts`) so
 * that component definitions only need to pass a `ChatTheme` rather than the
 * bare `FontConfig` that the underlying engine accepts.
 *
 * `measureRuns` — measure a `ProseBlock` at a given width; returns a
 *                 `Measured<ProseLaidOut>` with `top: 0` (the parent stack
 *                 combinator supplies the actual absolute position).
 *
 * `naturalWidth` — measure the intrinsic (unwrapped) content width of a
 *                  `ProseBlock`; used by the user-bubble hug algorithm.
 */

import { layoutProse, measureProseNaturalWidth } from '../../components/prose/layout';
import type { ProseBlock } from '../blocks/block-types';
import type { Measured } from '../define';
import type { ProseLaidOut } from '../layout/layout-types';
import type { ChatTheme } from '../theme';

/**
 * Measure a ProseBlock at `width` pixels using the theme's FontConfig.
 *
 * `top` is always 0: the parent combinator (stack / bubble) places the block
 * at the correct position within the composed layout tree.
 */
export function measureRuns(
  block: ProseBlock,
  width: number,
  theme: ChatTheme
): Measured<ProseLaidOut> {
  const laid = layoutProse(block, width, theme.fonts, 0);
  return { height: laid.height, width: laid.contentWidth, layout: laid };
}

/**
 * Intrinsic (natural) content width of a ProseBlock.
 *
 * Used by the message composite to compute the user-bubble hug width without
 * invoking the full line-breaking algorithm.
 */
export function naturalWidth(block: ProseBlock, theme: ChatTheme): number {
  return measureProseNaturalWidth(block, theme.fonts);
}

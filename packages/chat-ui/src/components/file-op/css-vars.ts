/**
 * fileOpCssVars — exposes file-op layout constants as CSS custom properties.
 *
 * Kept in its own module so tests that only need CSS-var parity checks do
 * not transitively import SolidJS or component dependencies.
 */

import {
  FILEOP_FADE_H,
  FILEOP_LINE_H,
  FILEOP_PAD_Y,
  FILEOP_ROW_H,
  FILEOP_WINDOW_H,
} from './metrics';

export function fileOpCssVars(): Record<string, string> {
  return {
    '--chat-fileop-row-h': `${FILEOP_ROW_H}px`,
    '--chat-fileop-line-h': `${FILEOP_LINE_H}px`,
    '--chat-fileop-window-h': `${FILEOP_WINDOW_H}px`,
    '--chat-fileop-fade-h': `${FILEOP_FADE_H}px`,
    '--chat-fileop-pad-y': `${FILEOP_PAD_Y}px`,
  };
}

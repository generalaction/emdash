/**
 * diffCssVars — exposes diff layout constants as CSS custom properties.
 *
 * Registered in css-vars.ts so all --chat-diff-* vars resolve consistently
 * across all renderers via the transcript root element.
 */

import { DIFF_HEADER_H, DIFF_PAD_Y } from './metrics';

export function diffCssVars(): Record<string, string> {
  return {
    '--chat-diff-header-h': `${DIFF_HEADER_H}px`,
    '--chat-diff-pad-y': `${DIFF_PAD_Y}px`,
  };
}

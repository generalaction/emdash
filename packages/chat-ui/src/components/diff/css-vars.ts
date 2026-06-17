/**
 * diffCssVars — exposes diff layout constants as CSS custom properties.
 *
 * Registered in css-vars.ts so all --chat-diff-* vars resolve consistently
 * across all renderers via the transcript root element.
 */

import { DIFF_FADE_H, DIFF_HEADER_H } from './metrics';

export function diffCssVars(): Record<string, string> {
  return {
    '--chat-diff-header-h': `${DIFF_HEADER_H}px`,
    '--chat-diff-fade-h': `${DIFF_FADE_H}px`,
  };
}

/**
 * thinkingCssVars — exposes thinking layout constants as CSS variables.
 *
 * Kept in its own module so tests that only need the CSS-var parity check do
 * not transitively import parse-blocks / remark-gfm (DOM-only dependencies).
 */

import { THINKING_FADE_H, THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';

export function thinkingCssVars(): Record<string, string> {
  return {
    '--chat-think-header-h': `${THINKING_HEADER_H}px`,
    '--chat-think-window-h': `${THINKING_WINDOW_H}px`,
    '--chat-think-fade-h': `${THINKING_FADE_H}px`,
    '--chat-think-pad-y': `${THINKING_PAD_Y}px`,
  };
}

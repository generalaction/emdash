/**
 * execCssVars — exposes execute layout constants as CSS custom properties.
 *
 * Kept in its own module so tests that only need CSS-var parity checks do
 * not transitively import SolidJS or component dependencies.
 */

import { EXEC_LINE_H, EXEC_MAX_LINES, EXEC_PAD_Y, EXEC_ROW_H } from './metrics';

export function execCssVars(): Record<string, string> {
  return {
    '--chat-exec-row-h': `${EXEC_ROW_H}px`,
    '--chat-exec-line-h': `${EXEC_LINE_H}px`,
    '--chat-exec-pad-y': `${EXEC_PAD_Y}px`,
    '--chat-exec-max-h': `${EXEC_MAX_LINES * EXEC_LINE_H + 2 * EXEC_PAD_Y}px`,
  };
}

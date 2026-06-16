/**
 * messageCssVars — CSS custom properties for the message row.
 *
 * Extracted into a separate file so it can be tested in node environment
 * without pulling in the JSX render tree or parse-blocks.
 */

import { BLOCK_GAP, BUBBLE_PAD_X, BUBBLE_PAD_Y } from './metrics';

export { BLOCK_GAP, BUBBLE_PAD_X, BUBBLE_PAD_Y };

export function messageCssVars(): Record<string, string> {
  return {
    '--chat-bubble-pad-x': `${BUBBLE_PAD_X}px`,
    '--chat-bubble-pad-y': `${BUBBLE_PAD_Y}px`,
    '--chat-block-gap': `${BLOCK_GAP}px`,
  };
}

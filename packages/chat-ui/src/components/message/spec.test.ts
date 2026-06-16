/**
 * messageRow parity — CSS vars must match bubble/block geometry constants.
 *
 * Imports from css-vars.ts (not spec.tsx) to avoid pulling in the JSX render
 * tree and parse-blocks.ts, which require a DOM environment.
 */

import { describe, expect, it } from 'vitest';
import { BLOCK_GAP, BUBBLE_PAD_X, BUBBLE_PAD_Y, messageCssVars } from './css-vars';

describe('messageCssVars() parity', () => {
  it('--chat-bubble-pad-x matches BUBBLE_PAD_X', () => {
    expect(messageCssVars()['--chat-bubble-pad-x']).toBe(`${BUBBLE_PAD_X}px`);
  });

  it('--chat-bubble-pad-y matches BUBBLE_PAD_Y', () => {
    expect(messageCssVars()['--chat-bubble-pad-y']).toBe(`${BUBBLE_PAD_Y}px`);
  });

  it('--chat-block-gap matches BLOCK_GAP', () => {
    expect(messageCssVars()['--chat-block-gap']).toBe(`${BLOCK_GAP}px`);
  });
});

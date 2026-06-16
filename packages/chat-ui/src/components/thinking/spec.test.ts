/**
 * thinkingRow parity — CSS vars must match metrics constants.
 */

import { describe, expect, it } from 'vitest';
import { THINKING_FADE_H, THINKING_HEADER_H, THINKING_PAD_Y, THINKING_WINDOW_H } from './metrics';
import { thinkingCssVars } from './spec';

describe('thinkingCssVars() parity', () => {
  it('--chat-think-header-h matches THINKING_HEADER_H', () => {
    expect(thinkingCssVars()['--chat-think-header-h']).toBe(`${THINKING_HEADER_H}px`);
  });

  it('--chat-think-window-h matches THINKING_WINDOW_H', () => {
    expect(thinkingCssVars()['--chat-think-window-h']).toBe(`${THINKING_WINDOW_H}px`);
  });

  it('--chat-think-fade-h matches THINKING_FADE_H', () => {
    expect(thinkingCssVars()['--chat-think-fade-h']).toBe(`${THINKING_FADE_H}px`);
  });

  it('--chat-think-pad-y matches THINKING_PAD_Y', () => {
    expect(thinkingCssVars()['--chat-think-pad-y']).toBe(`${THINKING_PAD_Y}px`);
  });
});

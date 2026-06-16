/**
 * codeSpec parity — CSS vars must match the geometry constants in metrics.ts.
 *
 * If CODE_BLOCK_PAD_Y changes in metrics.ts but cssVars() is not updated
 * (or vice versa), this test catches the drift at CI time.
 */

import { describe, expect, it } from 'vitest';
import { CODE_BLOCK } from '../../core/metrics';
import { CODE_BLOCK_BORDER, CODE_BLOCK_PAD_X, CODE_BLOCK_PAD_Y } from './metrics';
import { codeSpec } from './spec';

describe('codeSpec.cssVars() parity', () => {
  it('--chat-code-pad-y matches CODE_BLOCK_PAD_Y', () => {
    expect(codeSpec.cssVars()['--chat-code-pad-y']).toBe(`${CODE_BLOCK_PAD_Y}px`);
  });

  it('--chat-code-pad-x matches CODE_BLOCK_PAD_X', () => {
    expect(codeSpec.cssVars()['--chat-code-pad-x']).toBe(`${CODE_BLOCK_PAD_X}px`);
  });

  it('--chat-code-border matches CODE_BLOCK_BORDER', () => {
    expect(codeSpec.cssVars()['--chat-code-border']).toBe(`${CODE_BLOCK_BORDER}px`);
  });
});

describe('codeSpec.metrics parity', () => {
  it('metrics.padY matches CODE_BLOCK_PAD_Y', () => {
    expect(codeSpec.metrics.padY).toBe(CODE_BLOCK_PAD_Y);
  });

  it('metrics.padX matches CODE_BLOCK_PAD_X', () => {
    expect(codeSpec.metrics.padX).toBe(CODE_BLOCK_PAD_X);
  });

  it('metrics.border matches CODE_BLOCK_BORDER', () => {
    expect(codeSpec.metrics.border).toBe(CODE_BLOCK_BORDER);
  });
});

describe('codeSpec.cssVars() line-height parity', () => {
  it('--chat-code-lh is emitted as a direct px value (not a var()-wrapped token)', () => {
    // The CSS must use the exact same numeric value the layout engine uses.
    // If it were a var(--typography-*) indirection the browser could resolve
    // a different px than CODE_BLOCK.lineHeight and every code block line
    // would accumulate rounding drift.
    expect(codeSpec.cssVars()['--chat-code-lh']).toBe(`${CODE_BLOCK.lineHeight}px`);
  });
});

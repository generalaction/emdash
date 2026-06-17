/**
 * measure.ts unit tests — estimateDiff and measureDiff.
 *
 * Mirrors the pattern in execute/measure.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT_CONFIG } from '../../core/measure/fonts';
import type { ChatDiff } from '../../model';
import { diffCssVars } from './css-vars';
import { estimateDiff, measureDiff } from './measure';
import { DIFF_HEADER_H, DIFF_MAX_LINES, DIFF_PAD_Y } from './metrics';

const FONTS = DEFAULT_FONT_CONFIG;

function makeItem(overrides: Partial<ChatDiff> = {}): ChatDiff {
  return {
    kind: 'diff',
    id: 'tc1:src/model.ts',
    path: 'src/model.ts',
    oldText: 'old\ntext',
    newText: 'new\ntext\nadded',
    status: 'done',
    ...overrides,
  };
}

// ── CSS var parity ─────────────────────────────────────────────────────────────

describe('diffCssVars() parity', () => {
  it('--chat-diff-header-h matches DIFF_HEADER_H', () => {
    expect(diffCssVars()['--chat-diff-header-h']).toBe(`${DIFF_HEADER_H}px`);
  });

  it('--chat-diff-pad-y matches DIFF_PAD_Y', () => {
    expect(diffCssVars()['--chat-diff-pad-y']).toBe(`${DIFF_PAD_Y}px`);
  });
});

// ── estimateDiff ──────────────────────────────────────────────────────────────

describe('estimateDiff()', () => {
  it('returns an upper-bound constant (header + max lines + padding)', () => {
    const estimated = estimateDiff(FONTS);
    const expected = DIFF_HEADER_H + DIFF_MAX_LINES * FONTS.code.lineHeight + 2 * DIFF_PAD_Y;
    expect(estimated).toBe(expected);
  });
});

// ── measureDiff ───────────────────────────────────────────────────────────────

describe('measureDiff()', () => {
  it('returns height = header only for identical text (no changes)', () => {
    const item = makeItem({ oldText: 'same', newText: 'same' });
    const { height, previewRows, adds, dels } = measureDiff(item, FONTS);
    expect(height).toBe(DIFF_HEADER_H);
    expect(previewRows).toHaveLength(0);
    expect(adds).toBe(0);
    expect(dels).toBe(0);
  });

  it('height <= estimateDiff for all inputs', () => {
    const estimate = estimateDiff(FONTS);
    const item = makeItem();
    const { height } = measureDiff(item, FONTS);
    expect(height).toBeLessThanOrEqual(estimate);
  });

  it('null oldText → all adds, height correct', () => {
    const item = makeItem({ oldText: null, newText: 'a\nb\nc' });
    const { adds, dels, previewRows, height } = measureDiff(item, FONTS);
    expect(dels).toBe(0);
    expect(adds).toBe(3);
    expect(previewRows.length).toBe(3);
    const expected = DIFF_HEADER_H + 3 * FONTS.code.lineHeight + 2 * DIFF_PAD_Y;
    expect(height).toBe(expected);
  });

  it('returns lang from path extension', () => {
    const item = makeItem({ path: 'src/foo.ts' });
    const { lang } = measureDiff(item, FONTS);
    expect(lang).toBe('typescript');
  });

  it('returns undefined lang for unknown extension', () => {
    const item = makeItem({ path: 'src/foo.xyz' });
    const { lang } = measureDiff(item, FONTS);
    expect(lang).toBeUndefined();
  });

  it('previewRows capped at DIFF_MAX_LINES', () => {
    const longNew = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n');
    const item = makeItem({ oldText: null, newText: longNew });
    const { previewRows } = measureDiff(item, FONTS);
    expect(previewRows.length).toBeLessThanOrEqual(DIFF_MAX_LINES);
  });
});

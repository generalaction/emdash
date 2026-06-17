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
import { DIFF_BORDER, DIFF_FADE_H, DIFF_HEADER_H, DIFF_MAX_LINES } from './metrics';

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

  it('--chat-diff-fade-h matches DIFF_FADE_H', () => {
    expect(diffCssVars()['--chat-diff-fade-h']).toBe(`${DIFF_FADE_H}px`);
  });
});

// ── estimateDiff ──────────────────────────────────────────────────────────────

describe('estimateDiff()', () => {
  it('returns an upper-bound constant (header + max lines + border)', () => {
    const estimated = estimateDiff(FONTS);
    const expected = DIFF_HEADER_H + DIFF_MAX_LINES * FONTS.code.lineHeight + 2 * DIFF_BORDER;
    expect(estimated).toBe(expected);
  });
});

// ── measureDiff ───────────────────────────────────────────────────────────────

describe('measureDiff()', () => {
  it('returns height = header + border only for identical text (no changes)', () => {
    const item = makeItem({ oldText: 'same', newText: 'same' });
    const { height, previewRows, adds, dels, truncated } = measureDiff(item, FONTS);
    expect(height).toBe(DIFF_HEADER_H + 2 * DIFF_BORDER);
    expect(previewRows).toHaveLength(0);
    expect(adds).toBe(0);
    expect(dels).toBe(0);
    expect(truncated).toBe(false);
  });

  it('height <= estimateDiff for all inputs', () => {
    const estimate = estimateDiff(FONTS);
    const item = makeItem();
    const { height } = measureDiff(item, FONTS);
    expect(height).toBeLessThanOrEqual(estimate);
  });

  it('null oldText → all adds, height correct', () => {
    const item = makeItem({ oldText: null, newText: 'a\nb\nc' });
    const { adds, dels, previewRows, height, truncated } = measureDiff(item, FONTS);
    expect(dels).toBe(0);
    expect(adds).toBe(3);
    expect(previewRows.length).toBe(3);
    const expected = DIFF_HEADER_H + 3 * FONTS.code.lineHeight + 2 * DIFF_BORDER;
    expect(height).toBe(expected);
    expect(truncated).toBe(false);
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

  it('truncated = true when the window omits trailing content', () => {
    const longNew = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n');
    const item = makeItem({ oldText: null, newText: longNew });
    const { truncated } = measureDiff(item, FONTS);
    expect(truncated).toBe(true);
  });

  it('truncated = false when the full diff fits in the window', () => {
    const item = makeItem({ oldText: null, newText: 'a\nb\nc' });
    const { truncated } = measureDiff(item, FONTS);
    expect(truncated).toBe(false);
  });
});

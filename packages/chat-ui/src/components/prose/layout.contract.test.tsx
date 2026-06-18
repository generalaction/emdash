/**
 * layoutProse break semantics — browser contract tests.
 *
 * Runs in the browser (Playwright/Chromium) Vitest project because pretext
 * requires OffscreenCanvas for glyph measurement. Tests structural properties
 * of the segment-aware line layout: line count, top offsets, and runIndex
 * mapping across InlineBreak boundaries.
 */

import { describe, expect, it } from 'vitest';
import type { ProseBlock } from '../../core/markdown/document';
import { DEFAULT_FONT_CONFIG } from '../../core/measure/fonts';
import { layoutProse, measureProseNaturalWidth } from './layout';

const LH = DEFAULT_FONT_CONFIG.body.lineHeight;

function bodyBlock(runs: ProseBlock['runs']): ProseBlock {
  return { kind: 'prose', id: 'b0', variant: 'body', runs };
}

describe('layoutProse — break runs', () => {
  it('no breaks: single line for short text', () => {
    const block = bodyBlock([{ kind: 'text', text: 'hello' }]);
    const laid = layoutProse(block, 600, DEFAULT_FONT_CONFIG, 0);
    expect(laid.lines.length).toBe(1);
    expect(laid.height).toBe(LH);
  });

  it('one soft break forces two lines', () => {
    const block = bodyBlock([
      { kind: 'text', text: 'line one' },
      { kind: 'break' },
      { kind: 'text', text: 'line two' },
    ]);
    const laid = layoutProse(block, 600, DEFAULT_FONT_CONFIG, 0);
    expect(laid.lines.length).toBe(2);
    expect(laid.height).toBe(2 * LH);
    expect(laid.lines[0].top).toBe(0);
    expect(laid.lines[1].top).toBe(LH);
  });

  it('consecutive breaks produce a blank line', () => {
    const block = bodyBlock([
      { kind: 'text', text: 'first' },
      { kind: 'break' },
      { kind: 'break' },
      { kind: 'text', text: 'third' },
    ]);
    const laid = layoutProse(block, 600, DEFAULT_FONT_CONFIG, 0);
    // "first" lands on line 0; empty segment advances globalLine to 1; "third" lands on line 2.
    expect(laid.lines.length).toBe(2);
    expect(laid.height).toBe(3 * LH);
    expect(laid.lines[1].top).toBe(2 * LH);
  });

  it('leading break produces a blank first line', () => {
    const block = bodyBlock([{ kind: 'break' }, { kind: 'text', text: 'after' }]);
    const laid = layoutProse(block, 600, DEFAULT_FONT_CONFIG, 0);
    expect(laid.lines.length).toBe(1);
    expect(laid.height).toBe(2 * LH);
    expect(laid.lines[0].top).toBe(LH);
  });

  it('runIndex maps correctly across a segment boundary', () => {
    // runs: [text(0), break(1), text(2)]
    const block = bodyBlock([
      { kind: 'text', text: 'A' },
      { kind: 'break' },
      { kind: 'text', text: 'B' },
    ]);
    const laid = layoutProse(block, 600, DEFAULT_FONT_CONFIG, 0);
    expect(laid.lines[0].fragments[0].runIndex).toBe(0);
    expect(laid.lines[1].fragments[0].runIndex).toBe(2);
  });

  it('measureProseNaturalWidth returns max width across segments', () => {
    const short = bodyBlock([{ kind: 'text', text: 'hi' }]);
    const long = bodyBlock([{ kind: 'text', text: 'a much longer line of text here' }]);
    const combined = bodyBlock([
      { kind: 'text', text: 'hi' },
      { kind: 'break' },
      { kind: 'text', text: 'a much longer line of text here' },
    ]);
    const wShort = measureProseNaturalWidth(short, DEFAULT_FONT_CONFIG);
    const wLong = measureProseNaturalWidth(long, DEFAULT_FONT_CONFIG);
    const wCombined = measureProseNaturalWidth(combined, DEFAULT_FONT_CONFIG);
    // Combined should equal the longer segment's width.
    expect(wCombined).toBeCloseTo(Math.max(wShort, wLong), 1);
  });
});

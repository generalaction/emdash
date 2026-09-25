import { DEFAULT_THEME } from '@core/theme';
import { describe, expect, it } from 'vitest';
import { estimateCharsPerLine, estimateMarkdownHeight } from './estimate-text';

const theme = DEFAULT_THEME;
const WIDTH = 880;

const bodyLH = theme.config.roles.body.lineHeight; // 20
const codeLH = theme.config.roles.code.lineHeight; // 20

describe('estimateCharsPerLine', () => {
  it('derives chars-per-line from width and body font size', () => {
    const cpl = estimateCharsPerLine(WIDTH, theme);
    // ~100 chars at 880px with a 14px body font. The audit harness measured
    // real prose wrapping at 97–105 chars/line at this width.
    expect(cpl).toBeGreaterThanOrEqual(90);
    expect(cpl).toBeLessThanOrEqual(110);
  });

  it('scales linearly with width', () => {
    const wide = estimateCharsPerLine(880, theme);
    const narrow = estimateCharsPerLine(440, theme);
    expect(narrow).toBeGreaterThanOrEqual(Math.floor(wide / 2) - 1);
    expect(narrow).toBeLessThanOrEqual(Math.ceil(wide / 2) + 1);
  });

  it('never collapses below a sane floor', () => {
    expect(estimateCharsPerLine(10, theme)).toBeGreaterThanOrEqual(16);
  });
});

describe('estimateMarkdownHeight', () => {
  it('returns one body line for empty text', () => {
    expect(estimateMarkdownHeight('', WIDTH, theme)).toBe(bodyLH);
  });

  it('estimates a short paragraph as a single line', () => {
    expect(estimateMarkdownHeight('short text', WIDTH, theme)).toBe(bodyLH);
  });

  it('wraps long paragraphs by width-derived chars-per-line', () => {
    const cpl = estimateCharsPerLine(WIDTH, theme);
    const text = 'x'.repeat(cpl * 3 + 1); // must wrap onto a 4th line
    expect(estimateMarkdownHeight(text, WIDTH, theme)).toBe(4 * bodyLH);
  });

  it('estimates more height at narrower widths for the same text', () => {
    const text = 'word '.repeat(80);
    const wide = estimateMarkdownHeight(text, 880, theme);
    const narrow = estimateMarkdownHeight(text, 440, theme);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('counts fenced code lines at code line height plus chrome, not prose wrap', () => {
    const codeLines = Array.from({ length: 10 }, (_, i) => `const v${i} = compute(${i});`);
    const text = `\`\`\`ts\n${codeLines.join('\n')}\n\`\`\``;
    const est = estimateMarkdownHeight(text, WIDTH, theme);
    // 10 code lines + padding/border chrome (18px), no prose treatment.
    expect(est).toBe(10 * codeLH + 18);
  });

  it('treats an unclosed fence (streaming) as code', () => {
    const text = '```ts\nline1\nline2';
    const est = estimateMarkdownHeight(text, WIDTH, theme);
    expect(est).toBe(2 * codeLH + 18);
  });

  it('separates paragraphs around a code fence with collapsed margins', () => {
    const text = `intro text\n\n\`\`\`ts\ncode();\n\`\`\`\n\noutro text`;
    const est = estimateMarkdownHeight(text, WIDTH, theme);
    // para(20) + gap max(6,8)=8 + code(20+18) + gap 8 + para(20)
    expect(est).toBe(bodyLH + 8 + (codeLH + 18) + 8 + bodyLH);
  });

  it('gives each list item its own line block with tight margins', () => {
    const text = '- alpha\n- beta\n- gamma';
    const est = estimateMarkdownHeight(text, WIDTH, theme);
    // 3 items x 20 + 2 gaps of max(2,2)=2
    expect(est).toBe(3 * bodyLH + 2 * 2);
  });

  it('uses heading line heights and margins for # lines', () => {
    const h3LH = theme.config.roles.h3.lineHeight; // 22
    const text = '### plan\n\nbody paragraph';
    const est = estimateMarkdownHeight(text, WIDTH, theme);
    // h3(22) + gap max(4,6)=6 + para(20)
    expect(est).toBe(h3LH + 6 + bodyLH);
  });

  it('handles blockquote lines with prose margins', () => {
    const text = 'para\n\n> quoted line';
    const est = estimateMarkdownHeight(text, WIDTH, theme);
    // para(20) + gap max(6,6)=6 + quote(20)
    expect(est).toBe(bodyLH + 6 + bodyLH);
  });

  it('joins consecutive non-blank lines into one paragraph', () => {
    const text = 'line one\nline two continuation';
    // Joined: still fits one wrapped line at 880px.
    expect(estimateMarkdownHeight(text, WIDTH, theme)).toBe(bodyLH);
  });
});

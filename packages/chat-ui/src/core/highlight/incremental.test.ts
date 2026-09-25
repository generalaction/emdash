import { describe, expect, it } from 'vitest';
import { computeHighlightRaw, getDefaultShikiHighlighter } from './highlighter';
import { tokenizeIncremental } from './incremental';

/** Immediate yield — no idle scheduling in tests. */
const noYield = () => Promise.resolve();

function unwrap<T>(value: T | null): T {
  if (value === null) throw new Error('expected non-null result');
  return value;
}

const TS_SAMPLE = [
  'const greeting: string = `hello',
  'world`; // template literal spans lines',
  '',
  'export function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
].join('\n');

describe('tokenizeIncremental', () => {
  it('produces the same result as the synchronous whole-block path', async () => {
    const expected = computeHighlightRaw(TS_SAMPLE, 'typescript');
    const actual = unwrap(
      await tokenizeIncremental(getDefaultShikiHighlighter(), TS_SAMPLE, 'typescript', {
        yieldToIdle: noYield,
      })
    );
    expect(actual.rootStyle).toBe(expected.rootStyle);
    expect(actual.lines).toEqual(expected.lines);
  });

  it('carries grammar state across slice boundaries', async () => {
    // Force a yield between every line: the multi-line template literal must
    // still tokenize as a string on the second line.
    const expected = computeHighlightRaw(TS_SAMPLE, 'typescript');
    const actual = unwrap(
      await tokenizeIncremental(getDefaultShikiHighlighter(), TS_SAMPLE, 'typescript', {
        yieldToIdle: noYield,
        budgetMs: 0, // exhaust budget after every line
      })
    );
    expect(actual.lines).toEqual(expected.lines);
  });

  it('yields between slices when the budget is exhausted', async () => {
    let yields = 0;
    const bigCode = Array.from({ length: 50 }, (_, i) => `const v${i} = compute(${i});`).join('\n');
    await tokenizeIncremental(getDefaultShikiHighlighter(), bigCode, 'typescript', {
      yieldToIdle: () => {
        yields++;
        return Promise.resolve();
      },
      budgetMs: 0,
    });
    // budget 0 → one line per slice → a yield before every line after the first.
    expect(yields).toBeGreaterThanOrEqual(49);
  });

  it('does not yield for small blocks within budget', async () => {
    let yields = 0;
    await tokenizeIncremental(getDefaultShikiHighlighter(), 'const a = 1;', 'typescript', {
      yieldToIdle: () => {
        yields++;
        return Promise.resolve();
      },
    });
    expect(yields).toBe(0);
  });

  it('handles trailing newline (line count matches split)', async () => {
    const code = 'const a = 1;\n';
    const expected = computeHighlightRaw(code, 'typescript');
    const actual = unwrap(
      await tokenizeIncremental(getDefaultShikiHighlighter(), code, 'typescript', {
        yieldToIdle: noYield,
      })
    );
    expect(actual.lines.length).toBe(code.split('\n').length);
    expect(actual.lines).toEqual(expected.lines);
  });

  it('handles a single-line block', async () => {
    const code = 'const one = 1;';
    const expected = computeHighlightRaw(code, 'typescript');
    const actual = unwrap(
      await tokenizeIncremental(getDefaultShikiHighlighter(), code, 'typescript', {
        yieldToIdle: noYield,
      })
    );
    expect(actual.lines).toEqual(expected.lines);
  });

  it('stops early when cancelled between slices', async () => {
    let cancelled = false;
    const bigCode = Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const result = await tokenizeIncremental(getDefaultShikiHighlighter(), bigCode, 'typescript', {
      yieldToIdle: () => {
        cancelled = true;
        return Promise.resolve();
      },
      budgetMs: 0,
      isCancelled: () => cancelled,
    });
    expect(result).toBeNull();
  });
});

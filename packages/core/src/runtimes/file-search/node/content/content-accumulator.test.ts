import {
  CONTENT_SEARCH_MAX_LINE_LENGTH,
  CONTENT_SEARCH_MAX_TEXT_LENGTH,
} from '@runtimes/file-search/api';
import { describe, expect, it, vi } from 'vitest';
import { relativePath as relative } from '../testing/paths';
import { ContentSearchAccumulator } from './content-accumulator';

describe('ContentSearchAccumulator', () => {
  it('stops before aggregate line text can exceed the contract bound', () => {
    const accumulator = new ContentSearchAccumulator({
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    const text = 'x'.repeat(CONTENT_SEARCH_MAX_LINE_LENGTH);
    const acceptedLines = CONTENT_SEARCH_MAX_TEXT_LENGTH / CONTENT_SEARCH_MAX_LINE_LENGTH;

    for (let index = 0; index < acceptedLines; index += 1) {
      expect(
        accumulator.add(
          relative('src/index.ts'),
          {
            lineNumber: index + 1,
            text,
            ranges: [{ startColumn: 1, endColumn: 2 }],
          },
          10_000
        )
      ).toBe(false);
    }
    expect(
      accumulator.add(
        relative('src/index.ts'),
        {
          lineNumber: acceptedLines + 1,
          text,
          ranges: [{ startColumn: 1, endColumn: 2 }],
        },
        10_000
      )
    ).toBe(true);
    expect(accumulator.result(true).files[0].matches).toHaveLength(acceptedLines);
  });

  it('does not turn an unexpected progress callback failure into a typed search error', () => {
    const bug = new Error('progress callback bug');
    const accumulator = new ContentSearchAccumulator({
      signal: new AbortController().signal,
      onProgress: () => {
        throw bug;
      },
    });
    accumulator.add(
      relative('index.ts'),
      {
        lineNumber: 1,
        text: 'term',
        ranges: [{ startColumn: 1, endColumn: 5 }],
      },
      10
    );

    expect(() => accumulator.result(false)).toThrow(bug);
  });
});

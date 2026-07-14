import { describe, expect, it } from 'vitest';
import {
  CONTENT_SEARCH_DEFAULT_LIMIT,
  CONTENT_SEARCH_MAX_LINE_LENGTH,
  CONTENT_SEARCH_MAX_LIMIT,
  CONTENT_SEARCH_MAX_TEXT_LENGTH,
  FILE_SEARCH_MAX_QUERY_LENGTH,
  PATH_SEARCH_DEFAULT_LIMIT,
  PATH_SEARCH_MAX_LIMIT,
  contentSearchInputSchema,
  contentSearchProgressSchema,
  contentSearchResultSchema,
  fileSearchRootInputSchema,
  pathSearchInputSchema,
  pathSearchResultSchema,
} from './schemas';

const root = {
  root: { kind: 'posix' as const },
  segments: ['Users', 'jona', 'workspace'],
};

describe('file-search schemas', () => {
  it('uses one structured root input for registration and both search lanes', () => {
    expect(fileSearchRootInputSchema.parse({ root })).toEqual({ root });
    expect(
      pathSearchInputSchema.parse({ root, query: 'button', kinds: ['file', 'directory'] })
    ).toEqual({
      root,
      query: 'button',
      kinds: ['file', 'directory'],
    });
    expect(PATH_SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(CONTENT_SEARCH_DEFAULT_LIMIT).toBe(1_000);
  });

  it('allows an empty path query and requires at least one unique entry kind', () => {
    expect(pathSearchInputSchema.parse({ root, query: '', kinds: ['file'] })).toEqual({
      root,
      query: '',
      kinds: ['file'],
    });
    expect(() => pathSearchInputSchema.parse({ root, query: 'src', kinds: [] })).toThrow();
    expect(() => pathSearchInputSchema.parse({ root, query: 'src', kinds: ['symlink'] })).toThrow();
    expect(() =>
      pathSearchInputSchema.parse({ root, query: 'src', kinds: ['file', 'file'] })
    ).toThrow();
  });

  it('bounds path queries and requested result sizes', () => {
    expect(() =>
      pathSearchInputSchema.parse({
        root,
        query: 'x'.repeat(FILE_SEARCH_MAX_QUERY_LENGTH + 1),
        kinds: ['file'],
      })
    ).toThrow();
    expect(() =>
      pathSearchInputSchema.parse({
        root,
        query: 'src',
        kinds: ['file'],
        limit: PATH_SEARCH_MAX_LIMIT + 1,
      })
    ).toThrow();
  });

  it('normalizes returned path-search entries and preserves their kinds', () => {
    expect(
      pathSearchResultSchema.parse({
        hits: [
          { path: 'src/./components/../index.ts', kind: 'file' },
          { path: 'src/./components', kind: 'directory' },
        ],
      })
    ).toEqual({
      hits: [
        { path: 'src/index.ts', kind: 'file' },
        { path: 'src/components', kind: 'directory' },
      ],
    });
  });

  it('keeps initial content-search input limited to user text, scope, and result limit', () => {
    expect(
      contentSearchInputSchema.parse({
        root,
        query: 'FILE_SEARCH_DEFAULT_LIMIT',
        under: 'packages/core',
        limit: 500,
      })
    ).toEqual({
      root,
      query: 'FILE_SEARCH_DEFAULT_LIMIT',
      under: 'packages/core',
      limit: 500,
    });

    expect(() => contentSearchInputSchema.parse({ root, query: '' })).toThrow();
    expect(() => contentSearchInputSchema.parse({ root, query: 'first\nsecond' })).toThrow();
    expect(() => contentSearchInputSchema.parse({ root, query: 'term\0suffix' })).toThrow();
    expect(() =>
      contentSearchInputSchema.parse({
        root,
        query: 'term',
        limit: CONTENT_SEARCH_MAX_LIMIT + 1,
      })
    ).toThrow();
  });

  it('accepts append-only progress batches and an authoritative terminal result', () => {
    const files = [
      {
        path: 'packages/core/src/index.ts',
        matches: [
          {
            lineNumber: 7,
            text: 'const value = FILE_SEARCH_DEFAULT_LIMIT;',
            ranges: [{ startColumn: 15, endColumn: 40 }],
          },
        ],
      },
    ];

    expect(contentSearchProgressSchema.parse({ files })).toEqual({ files });
    expect(contentSearchResultSchema.parse({ files, limitHit: false })).toEqual({
      files,
      limitHit: false,
    });
    expect(() =>
      contentSearchResultSchema.parse({
        files: [
          {
            ...files[0],
            matches: [
              {
                ...files[0].matches[0],
                ranges: [{ startColumn: 10, endColumn: 10 }],
              },
            ],
          },
        ],
        limitHit: false,
      })
    ).toThrow();
  });

  it('bounds the actual number of returned content matches', () => {
    const ranges = Array.from({ length: CONTENT_SEARCH_MAX_LIMIT + 1 }, (_, index) => ({
      startColumn: index + 1,
      endColumn: index + 2,
    }));

    expect(() =>
      contentSearchResultSchema.parse({
        files: [
          {
            path: 'src/index.ts',
            matches: [{ lineNumber: 1, text: 'x', ranges }],
          },
        ],
        limitHit: true,
      })
    ).toThrow();
  });

  it('bounds individual lines and aggregate content text', () => {
    expect(() =>
      contentSearchResultSchema.parse({
        files: [
          {
            path: 'src/index.ts',
            matches: [
              {
                lineNumber: 1,
                text: 'x'.repeat(CONTENT_SEARCH_MAX_LINE_LENGTH + 1),
                ranges: [{ startColumn: 1, endColumn: 2 }],
              },
            ],
          },
        ],
        limitHit: true,
      })
    ).toThrow();

    const lineCount =
      Math.floor(CONTENT_SEARCH_MAX_TEXT_LENGTH / CONTENT_SEARCH_MAX_LINE_LENGTH) + 1;
    expect(() =>
      contentSearchResultSchema.parse({
        files: [
          {
            path: 'src/index.ts',
            matches: Array.from({ length: lineCount }, (_, index) => ({
              lineNumber: index + 1,
              text: 'x'.repeat(CONTENT_SEARCH_MAX_LINE_LENGTH),
              ranges: [{ startColumn: 1, endColumn: 2 }],
            })),
          },
        ],
        limitHit: true,
      })
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  FILE_SEARCH_DEFAULT_LIMIT,
  FILE_SEARCH_MAX_LIMIT,
  FILE_SEARCH_MAX_QUERY_LENGTH,
  fileSearchQuerySchema,
  fileSearchRegisterRootInputSchema,
  fileSearchResultSchema,
} from './schemas';

const root = {
  root: { kind: 'posix' as const },
  segments: ['Users', 'jona', 'workspace'],
};

describe('file-search schemas', () => {
  it('uses one structured root input for registration and search', () => {
    expect(fileSearchRegisterRootInputSchema.parse({ root })).toEqual({ root });
    expect(fileSearchQuerySchema.parse({ root, query: 'button' })).toEqual({
      root,
      query: 'button',
    });
    expect(FILE_SEARCH_DEFAULT_LIMIT).toBe(20);
  });

  it('bounds query and result sizes at the portable API boundary', () => {
    expect(() =>
      fileSearchQuerySchema.parse({ root, query: 'x'.repeat(FILE_SEARCH_MAX_QUERY_LENGTH + 1) })
    ).toThrow();
    expect(() =>
      fileSearchQuerySchema.parse({ root, query: '', limit: FILE_SEARCH_MAX_LIMIT + 1 })
    ).toThrow();
    expect(() => fileSearchQuerySchema.parse({ root, query: '', limit: 0 })).toThrow();
  });

  it('normalizes returned paths through the portable path schema', () => {
    expect(
      fileSearchResultSchema.parse({ hits: [{ path: 'src/./components/../index.ts' }] })
    ).toEqual({ hits: [{ path: 'src/index.ts' }] });
  });
});

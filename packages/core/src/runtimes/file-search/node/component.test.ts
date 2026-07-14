import { describe, expect, it } from 'vitest';
import { fileSearchComponentConfigSchema } from './component';

describe('fileSearchComponentConfigSchema', () => {
  it('requires a database path and accepts optional search-engine configuration', () => {
    expect(
      fileSearchComponentConfigSchema.parse({
        databasePath: '/tmp/file-search.db',
        ripgrepPath: 'rg',
        maxConcurrentScans: 2,
        maxConcurrentContentSearches: 4,
      })
    ).toEqual({
      databasePath: '/tmp/file-search.db',
      ripgrepPath: 'rg',
      maxConcurrentScans: 2,
      maxConcurrentContentSearches: 4,
    });
    expect(() => fileSearchComponentConfigSchema.parse({ databasePath: '' })).toThrow();
    expect(() =>
      fileSearchComponentConfigSchema.parse({
        databasePath: '/tmp/file-search.db',
        ripgrepPath: '',
      })
    ).toThrow();
    expect(() =>
      fileSearchComponentConfigSchema.parse({
        databasePath: '/tmp/file-search.db',
        maxConcurrentContentSearches: 0,
      })
    ).toThrow();
  });
});

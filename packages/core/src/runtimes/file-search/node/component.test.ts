import { describe, expect, it } from 'vitest';
import { fileSearchComponentConfigSchema } from './component';

describe('fileSearchComponentConfigSchema', () => {
  it('requires a database path and positive resource limits', () => {
    expect(fileSearchComponentConfigSchema.parse({ databasePath: '/tmp/file-search.db' })).toEqual({
      databasePath: '/tmp/file-search.db',
    });
    expect(() => fileSearchComponentConfigSchema.parse({ databasePath: '' })).toThrow();
    expect(() =>
      fileSearchComponentConfigSchema.parse({
        databasePath: '/tmp/file-search.db',
        maxConcurrentScans: 0,
      })
    ).toThrow();
  });
});

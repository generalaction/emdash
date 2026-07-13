import { fileContentModelSchema } from '@runtimes/files/api/content/state';
import { describe, expect, it } from 'vitest';
import { fileStatSchema } from './schemas';

describe('files schemas', () => {
  it('uses JSON-safe millisecond timestamps', () => {
    const value = {
      path: 'file.txt',
      type: 'file' as const,
      size: 4,
      mtimeMs: 100,
      ctimeMs: 90,
      mode: 0o644,
    };
    expect(fileStatSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(() => fileStatSchema.parse({ ...value, mtimeMs: new Date() })).toThrow();
  });

  it('round-trips unavailable content state', () => {
    const value = {
      kind: 'unavailable' as const,
      path: 'deleted.txt',
      error: { type: 'not-found' as const, path: 'deleted.txt' },
    };
    expect(fileContentModelSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });
});

import { describe, expect, it } from 'vitest';
import * as files from './index';

describe('@emdash/core/files public exports', () => {
  it('exports the files runtime and shared file-domain primitives', () => {
    const exported = files as Record<string, unknown>;

    expect(exported.FilesRuntime).toBeTypeOf('function');
    expect(exported.enumerate).toBeTypeOf('function');
    expect(exported.isIgnored).toBeTypeOf('function');
    expect(exported.watchIgnoreGlobs).toBeTypeOf('function');
    expect(exported.normalizeRelPath).toBeTypeOf('function');
    expect(exported.resolveInsideRoot).toBeTypeOf('function');
  });
});

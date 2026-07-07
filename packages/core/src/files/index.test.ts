import { describe, expect, it } from 'vitest';
import * as files from './index';

describe('@emdash/core/files public exports', () => {
  it('exports the files runtime and shared file-domain primitives', () => {
    const exported = files as Record<string, unknown>;

    expect(exported.FilesRuntime).toBeTypeOf('function');
    expect(exported.includeAllFiles).toBeTypeOf('function');
    expect(exported.createRootPathPolicy).toBeTypeOf('function');
    expect(exported.validateAbsolutePath).toBeTypeOf('function');
    expect(exported.isIgnored).toBeUndefined();
    expect(exported.watchIgnoreGlobs).toBeUndefined();
  });
});

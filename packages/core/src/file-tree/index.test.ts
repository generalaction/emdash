import { describe, expect, it } from 'vitest';
import * as fileTree from './index';

describe('@emdash/core/file-tree public exports', () => {
  it('exports the runtime and shared file-domain foundation but not concrete tree internals', () => {
    const exported = fileTree as Record<string, unknown>;

    expect(exported.FileTreeRuntime).toBeTypeOf('function');
    expect(exported.isIgnored).toBeTypeOf('function');
    expect(exported.watchIgnoreGlobs).toBeTypeOf('function');
    expect(exported.resolveInsideRoot).toBeTypeOf('function');
    expect(exported.FileTree).toBeUndefined();
    expect(exported.NodeIdAssigner).toBeUndefined();
    expect(exported.listChildren).toBeUndefined();
    expect(exported.statEntry).toBeUndefined();
  });
});

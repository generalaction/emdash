import { describe, expect, it } from 'vitest';
import * as fileTree from './index';

describe('@emdash/core/file-tree public exports', () => {
  it('exports the runtime but not concrete tree or internal helpers', () => {
    const exported = fileTree as Record<string, unknown>;

    expect(exported.FileTreeRuntime).toBeTypeOf('function');
    expect(exported.FileTree).toBeUndefined();
    expect(exported.NodeIdAssigner).toBeUndefined();
    expect(exported.listChildren).toBeUndefined();
    expect(exported.statEntry).toBeUndefined();
    expect(exported.resolveInsideRoot).toBeUndefined();
    expect(exported.watchIgnoreGlobs).toBeUndefined();
  });
});

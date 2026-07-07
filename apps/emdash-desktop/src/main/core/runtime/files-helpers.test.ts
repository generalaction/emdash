import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { contains, FilesRuntime } from '@emdash/core/files';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRealPathContained, realPathNearestExisting } from './files-helpers';
import type { IFilesRuntime, RuntimePath } from './types';

const nativeMachinePath: RuntimePath = {
  join: (...parts: string[]) => nodePath.join(...parts),
  dirname: (value: string) => nodePath.dirname(value),
  basename: (value: string) => nodePath.basename(value),
  isAbsolute: (value: string) => nodePath.isAbsolute(value),
  relative: (from: string, to: string) => nodePath.relative(from, to),
  contains,
};

function makeFilesRuntime(): IFilesRuntime {
  return Object.assign(new FilesRuntime(), { path: nativeMachinePath }) as IFilesRuntime;
}

describe('files-helpers realpath containment', () => {
  let root: string;
  let outside: string;
  const files = makeFilesRuntime();

  beforeEach(() => {
    root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'fh-root-'));
    outside = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'fh-out-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('treats a real path inside the root as contained', async () => {
    fs.mkdirSync(nodePath.join(root, 'inside'));
    const result = await isRealPathContained(
      files,
      root,
      nodePath.join(root, 'inside', 'file.txt')
    );
    expect(result.success && result.data).toBe(true);
  });

  it('rejects a write whose destination parent is a symlink escaping the root', async () => {
    // A symlinked subdirectory inside the root pointing outside it must not let a
    // write/copy land outside the worktree.
    fs.symlinkSync(outside, nodePath.join(root, 'escape'), 'dir');
    const result = await isRealPathContained(
      files,
      root,
      nodePath.join(root, 'escape', 'file.txt')
    );
    expect(result.success && result.data).toBe(false);
  });

  it('rejects removing an existing symlink that resolves outside the root', async () => {
    fs.symlinkSync(outside, nodePath.join(root, 'escape'), 'dir');
    const result = await isRealPathContained(files, root, nodePath.join(root, 'escape'), {
      candidateMustExist: true,
    });
    expect(result.success && result.data).toBe(false);
  });

  it('resolves the nearest existing ancestor for a non-existent path', async () => {
    fs.mkdirSync(nodePath.join(root, 'a'));
    const realRoot = fs.realpathSync(root);
    const resolved = await realPathNearestExisting(files, nodePath.join(root, 'a', 'b', 'c.txt'));
    expect(resolved.success && resolved.data).toBe(nodePath.join(realRoot, 'a', 'b', 'c.txt'));
  });
});

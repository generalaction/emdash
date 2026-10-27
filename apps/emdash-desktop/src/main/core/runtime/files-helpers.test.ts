import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { err, ok } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { filesClientScope } from '@core/services/runtime-broker/node/files';
import { isRealPathContained, realPathNearestExisting } from '../files/realpath-containment';
import { ensureAbsoluteDir } from './files-helpers';

function makeFiles(root: string) {
  return filesClientScope(
    {
      fs: {
        realPath: async ({ path: target }: { path: Parameters<typeof nativePathFromHost>[0] }) => {
          const filePath = nativePathFromHost(target);
          try {
            return ok({ path: hostPathFromNative(fs.realpathSync(filePath)) });
          } catch {
            return err({ type: 'not-found', path: filePath } as never);
          }
        },
      },
    } as never,
    root
  );
}

describe('realpath containment', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-root-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-out-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('treats a real path inside the root as contained', async () => {
    fs.mkdirSync(path.join(root, 'inside'));
    const result = await isRealPathContained(
      makeFiles(root),
      hostPathFromNative(root),
      hostPathFromNative(path.join(root, 'inside', 'file.txt'))
    );
    expect(result.success && result.data).toBe(true);
  });

  it('rejects a destination whose parent symlink escapes the root', async () => {
    fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');
    const result = await isRealPathContained(
      makeFiles(root),
      hostPathFromNative(root),
      hostPathFromNative(path.join(root, 'escape', 'file.txt'))
    );
    expect(result.success && result.data).toBe(false);
  });

  it('rejects an existing symlink that resolves outside the root', async () => {
    fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');
    const result = await isRealPathContained(
      makeFiles(root),
      hostPathFromNative(root),
      hostPathFromNative(path.join(root, 'escape')),
      { candidateMustExist: true }
    );
    expect(result.success && result.data).toBe(false);
  });

  it('resolves the nearest existing ancestor for a non-existent path', async () => {
    fs.mkdirSync(path.join(root, 'a'));
    const realRoot = fs.realpathSync(root);
    const resolved = await realPathNearestExisting(
      makeFiles(root),
      hostPathFromNative(path.join(root, 'a', 'b', 'c.txt'))
    );
    expect(resolved.success && nativePathFromHost(resolved.data)).toBe(
      path.join(realRoot, 'a', 'b', 'c.txt')
    );
  });

  it('uses Win32 case-insensitive semantics for realpath containment', async () => {
    const files = filesClientScope(
      {
        fs: {
          realPath: async ({ path: target }: { path: Parameters<typeof nativePathFromHost>[0] }) =>
            ok({ path: target }),
        },
      } as never,
      'C:\\Repo'
    );

    await expect(
      isRealPathContained(
        files,
        hostPathFromNative('C:\\Repo'),
        hostPathFromNative('c:\\REPO\\src\\file.ts')
      )
    ).resolves.toEqual(ok(true));
  });
});

describe('absolute directory creation', () => {
  it.each([
    {
      label: 'drive',
      root: 'C:\\repo',
      target: 'C:\\repo\\worktrees\\task',
      expected: ['C:\\repo', 'C:\\repo\\worktrees', 'C:\\repo\\worktrees\\task'],
    },
    {
      label: 'UNC',
      root: '\\\\server\\share\\repo',
      target: '\\\\server\\share\\repo\\worktrees\\task',
      expected: [
        '\\\\server\\share\\repo',
        '\\\\server\\share\\repo\\worktrees',
        '\\\\server\\share\\repo\\worktrees\\task',
      ],
    },
  ])(
    'uses the target $label root without desktop normalization',
    async ({ root, target, expected }) => {
      const created: string[] = [];
      const client = {
        fs: {
          exists: async () => ok({ exists: false }),
          createDirectory: async ({
            path: directory,
          }: {
            path: Parameters<typeof nativePathFromHost>[0];
          }) => {
            created.push(nativePathFromHost(directory));
            return ok();
          },
        },
      } as never;

      const result = await ensureAbsoluteDir(async () => client, root, target);

      expect(result).toEqual(ok());
      expect(created).toEqual(expected);
    }
  );
});

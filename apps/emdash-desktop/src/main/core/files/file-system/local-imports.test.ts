import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileSystem, type IFileSystem } from '@emdash/core/files';
import { ok } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyLocalFilesToWorkspace } from './local-imports';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('copyLocalFilesToWorkspace', () => {
  it('returns structured conflict paths instead of encoding them in the message', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-local-imports-'));
    roots.push(root);
    const srcPath = path.join(root, 'existing.txt');
    await writeFile(srcPath, 'content', 'utf8');

    const fileSystem = {
      mkdir: vi.fn(async () => ok<void>()),
      realPath: vi.fn(async (absPath: string) => ok(absPath)),
      exists: vi.fn(async (absPath: string) => ok(absPath === '/repo/existing.txt')),
      writeBytes: vi.fn(),
    } as unknown as IFileSystem;

    const result = await copyLocalFilesToWorkspace(fileSystem, '/repo', [srcPath], '/repo');

    expect(result).toEqual({
      success: false,
      error: {
        type: 'conflict',
        message: 'Files already exist',
        paths: ['existing.txt'],
      },
    });
    expect(fileSystem.writeBytes).not.toHaveBeenCalled();
  });

  it('rejects a destination directory that resolves through a symlink outside the workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-local-imports-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    try {
      await symlink(outside, path.join(workspace, 'escape'), 'dir');
    } catch {
      // Some environments disallow symlink creation.
      return;
    }
    const srcPath = path.join(root, 'source.txt');
    await writeFile(srcPath, 'content', 'utf8');

    const result = await copyLocalFilesToWorkspace(
      new FileSystem(),
      workspace,
      [srcPath],
      path.join(workspace, 'escape')
    );

    expect(result).toMatchObject({
      success: false,
      error: { type: 'fs_error', message: expect.stringContaining('outside the workspace') },
    });
    await expect(readFile(path.join(outside, 'source.txt'), 'utf8')).rejects.toThrow();
  });

  it('copies bytes from a source file symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-local-imports-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const targetPath = path.join(root, 'target.txt');
    const linkPath = path.join(root, 'source-link.txt');
    await writeFile(targetPath, 'target content', 'utf8');
    try {
      await symlink(targetPath, linkPath, 'file');
    } catch {
      // Some environments disallow symlink creation.
      return;
    }

    await expect(
      copyLocalFilesToWorkspace(new FileSystem(), workspace, [linkPath], workspace)
    ).resolves.toEqual({ success: true, data: { copied: 1 } });
    await expect(readFile(path.join(workspace, 'source-link.txt'), 'utf8')).resolves.toBe(
      'target content'
    );
  });
});

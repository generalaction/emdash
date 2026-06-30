import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
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
});

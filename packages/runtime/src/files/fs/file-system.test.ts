import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IWatchService } from '@emdash/core/watch';
import { afterEach, describe, expect, it } from 'vitest';
import { FilesRuntime } from '../files-runtime';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileSystemRuntime', () => {
  it('applies mutation overwrite, parent, rename, and deletion rules', async () => {
    const root = await makeRoot();
    const runtime = new FilesRuntime({ watcher: noopWatcher(), idleTtlMs: 0 });

    try {
      await expect(
        runtime.fs.createFile({ rootPath: root, path: 'missing/file.txt' })
      ).resolves.toMatchObject({ success: false, error: { type: 'not-found' } });
      await expect(
        runtime.fs.createDirectory({ rootPath: root, path: 'source' })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.createFile({ rootPath: root, path: 'source/file.txt', content: 'one' })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.createFile({ rootPath: root, path: 'source/file.txt' })
      ).resolves.toMatchObject({ success: false, error: { type: 'already-exists' } });
      await expect(
        runtime.fs.writeFile({
          rootPath: root,
          path: 'source/file.txt',
          content: Buffer.from('two').toString('base64'),
          encoding: 'base64',
        })
      ).resolves.toMatchObject({ success: true });
      await expect(readFile(path.join(root, 'source/file.txt'), 'utf8')).resolves.toBe('two');

      await expect(
        runtime.fs.createDirectory({ rootPath: root, path: 'destination' })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.rename({
          rootPath: root,
          from: 'source/file.txt',
          to: 'destination/file.txt',
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(
        runtime.fs.copy({
          rootPath: root,
          from: 'source/file.txt',
          to: 'destination/copied.txt',
        })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.move({
          rootPath: root,
          from: 'source/file.txt',
          to: 'destination/moved.txt',
        })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.delete({ rootPath: root, path: 'destination' })
      ).resolves.toMatchObject({ success: false, error: { type: 'io' } });
      await expect(
        runtime.fs.delete({ rootPath: root, path: 'destination', recursive: true })
      ).resolves.toMatchObject({ success: true });
    } finally {
      await runtime.dispose();
    }
  });

  it('does not mutate or enumerate entries reached through an outside-root symlink', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await mkdir(path.join(outside, 'nested'));
    const outsideFile = path.join(outside, 'nested/outside.txt');
    await writeFile(outsideFile, 'keep');
    try {
      await symlink(outside, path.join(root, 'linked'), 'dir');
    } catch {
      return;
    }
    const runtime = new FilesRuntime({ watcher: noopWatcher(), idleTtlMs: 0 });
    const context = {
      jobId: 'enumerate-outside',
      signal: new AbortController().signal,
      progress: () => {},
    };

    try {
      await expect(
        runtime.fs.delete({ rootPath: root, path: 'linked/nested/outside.txt' })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(
        runtime.fs.copy({
          rootPath: root,
          from: 'linked/nested/outside.txt',
          to: 'copied.txt',
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(
        runtime.fs.enumerate({ rootPath: root, path: 'linked/nested' }, context)
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(readFile(outsideFile, 'utf8')).resolves.toBe('keep');

      await expect(runtime.fs.delete({ rootPath: root, path: 'linked' })).resolves.toMatchObject({
        success: true,
      });
      await expect(readFile(outsideFile, 'utf8')).resolves.toBe('keep');
    } finally {
      await runtime.dispose();
    }
  });
});

async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-file-system-')));
  roots.push(root);
  return root;
}

function noopWatcher(): IWatchService {
  return {
    watch: () => ({ ready: async () => {}, release: async () => {} }),
    dispose: async () => {},
  };
}

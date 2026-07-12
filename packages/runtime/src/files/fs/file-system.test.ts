import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IWatchService } from '@emdash/core/services/fs-watch/api';
import { afterEach, describe, expect, it } from 'vitest';
import { FilesRuntime } from '../files-runtime';
import { relativePath, runtimeRoot } from '../testing/paths';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileSystemRuntime', () => {
  it('applies mutation overwrite, parent, rename, and deletion rules', async () => {
    const root = await makeRoot();
    const rootRef = runtimeRoot(root);
    const runtime = new FilesRuntime({ watcher: noopWatcher(), idleTtlMs: 0 });

    try {
      await expect(
        runtime.fs.createFile({ root: rootRef, path: relativePath('missing/file.txt') })
      ).resolves.toMatchObject({ success: false, error: { type: 'not-found' } });
      await expect(
        runtime.fs.createDirectory({ root: rootRef, path: relativePath('source') })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.createFile({
          root: rootRef,
          path: relativePath('source/file.txt'),
          content: 'one',
        })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.createFile({ root: rootRef, path: relativePath('source/file.txt') })
      ).resolves.toMatchObject({ success: false, error: { type: 'already-exists' } });
      await expect(
        runtime.fs.writeFile({
          root: rootRef,
          path: relativePath('source/file.txt'),
          content: Buffer.from('two').toString('base64'),
          encoding: 'base64',
          precondition: { kind: 'overwrite' },
        })
      ).resolves.toMatchObject({ success: true });
      await expect(readFile(path.join(root, 'source/file.txt'), 'utf8')).resolves.toBe('two');

      await expect(
        runtime.fs.createDirectory({ root: rootRef, path: relativePath('destination') })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.rename({
          root: rootRef,
          from: relativePath('source/file.txt'),
          to: relativePath('destination/file.txt'),
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(
        runtime.fs.copy({
          root: rootRef,
          from: relativePath('source/file.txt'),
          to: relativePath('destination/copied.txt'),
        })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.move({
          root: rootRef,
          from: relativePath('source/file.txt'),
          to: relativePath('destination/moved.txt'),
        })
      ).resolves.toMatchObject({ success: true });
      await expect(
        runtime.fs.delete({ root: rootRef, path: relativePath('destination') })
      ).resolves.toMatchObject({ success: false, error: { type: 'io' } });
      await expect(
        runtime.fs.delete({ root: rootRef, path: relativePath('destination'), recursive: true })
      ).resolves.toMatchObject({ success: true });
    } finally {
      await runtime.dispose();
    }
  });

  it('does not mutate or enumerate entries reached through an outside-root symlink', async () => {
    const root = await makeRoot();
    const rootRef = runtimeRoot(root);
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
        runtime.fs.delete({
          root: rootRef,
          path: relativePath('linked/nested/outside.txt'),
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(
        runtime.fs.copy({
          root: rootRef,
          from: relativePath('linked/nested/outside.txt'),
          to: relativePath('copied.txt'),
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(
        runtime.fs.enumerate({ root: rootRef, relative: relativePath('linked/nested') }, context)
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(readFile(outsideFile, 'utf8')).resolves.toBe('keep');

      await expect(
        runtime.fs.delete({ root: rootRef, path: relativePath('linked') })
      ).resolves.toMatchObject({ success: true });
      await expect(readFile(outsideFile, 'utf8')).resolves.toBe('keep');
    } finally {
      await runtime.dispose();
    }
  });

  it('serializes conditional writes against the same ETag', async () => {
    const root = await makeRoot();
    const rootRef = runtimeRoot(root);
    await writeFile(path.join(root, 'file.txt'), 'before');
    const runtime = new FilesRuntime({ watcher: noopWatcher(), idleTtlMs: 0 });

    try {
      const read = await runtime.fs.readText({
        root: rootRef,
        relative: relativePath('file.txt'),
      });
      expect(read.success).toBe(true);
      if (!read.success) throw read.error;

      const writes = await Promise.all([
        runtime.fs.writeFile({
          root: rootRef,
          path: relativePath('file.txt'),
          content: 'first',
          precondition: { kind: 'etag', etag: read.data.etag },
        }),
        runtime.fs.writeFile({
          root: rootRef,
          path: relativePath('file.txt'),
          content: 'second',
          precondition: { kind: 'etag', etag: read.data.etag },
        }),
      ]);

      expect(writes.filter((result) => result.success)).toHaveLength(1);
      expect(writes.filter((result) => !result.success)).toEqual([
        expect.objectContaining({ error: expect.objectContaining({ type: 'etag-mismatch' }) }),
      ]);
      await expect(readFile(path.join(root, 'file.txt'), 'utf8')).resolves.toMatch(
        /^(first|second)$/u
      );
    } finally {
      await runtime.dispose();
    }
  });

  it('measures reclaimable disk usage without counting external hardlinks', async () => {
    const root = await makeRoot();
    const rootRef = runtimeRoot(root);
    const task = path.join(root, 'task');
    const store = path.join(root, 'store');
    await mkdir(task);
    await mkdir(store);
    const storeFile = path.join(store, 'shared.bin');
    await writeFile(storeFile, 'x'.repeat(128 * 1024));
    await link(storeFile, path.join(task, 'shared.bin'));
    await writeFile(path.join(task, 'owned.txt'), 'owned');
    const runtime = new FilesRuntime({ watcher: noopWatcher(), idleTtlMs: 0 });

    try {
      const usage = await runtime.fs.measureUsage({
        root: rootRef,
        relative: relativePath('task'),
      });
      expect(usage.success).toBe(true);
      if (!usage.success) throw usage.error;
      expect(usage.data.type).toBe('directory');
      expect(usage.data.diskBytes).toBeGreaterThan(usage.data.exclusiveDiskBytes);
      expect(usage.data.errors).toEqual([]);
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

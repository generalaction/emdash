import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitFor } from '@emdash/shared/testing';
import { client, connect, memoryTransportPair, serve } from '@emdash/wire/rpc';
import { afterEach, describe, expect, it } from 'vitest';
import { filesContract } from '#runtimes/files/api';
import { FilesRuntime, type FilesRuntimeOptions } from '#runtimes/files/node/files-runtime';
import { relativePath, runtimeRoot } from '#runtimes/files/node/testing/paths';
import type { IWatchService, WatchEvent, WatchOptions } from '#services/fs-watch/api';
import { createFilesController } from './controller';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('files runtime absolute-path mutations', () => {
  it('creates files and directories at bare absolute paths', async () => {
    const dir = await makeDir();
    const { connection, dispose } = await makeRuntime();

    try {
      const filePath = runtimeRoot(path.join(dir, 'created.txt'));
      await expect(
        connection.api.mutations.createFile({ path: filePath, content: 'seeded\n' })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(readFile(path.join(dir, 'created.txt'), 'utf8')).resolves.toBe('seeded\n');

      await expect(connection.api.mutations.createFile({ path: filePath })).resolves.toMatchObject({
        success: false,
        error: { type: 'already-exists' },
      });

      await expect(
        connection.api.mutations.createDirectory({
          path: runtimeRoot(path.join(dir, 'made-dir')),
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(stat(path.join(dir, 'made-dir'))).resolves.toMatchObject({});
    } finally {
      await dispose();
    }
  });

  it('deletes files and directories at bare absolute paths', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'doomed.txt'), 'bye\n');
    await mkdir(path.join(dir, 'nested/deep'), { recursive: true });
    const { connection, dispose } = await makeRuntime();

    try {
      await expect(
        connection.api.mutations.delete({ path: runtimeRoot(path.join(dir, 'doomed.txt')) })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(stat(path.join(dir, 'doomed.txt'))).rejects.toMatchObject({ code: 'ENOENT' });

      await expect(
        connection.api.mutations.delete({
          path: runtimeRoot(path.join(dir, 'nested')),
          recursive: true,
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(stat(path.join(dir, 'nested'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await dispose();
    }
  });

  it('renames within one parent directory and rejects cross-directory renames', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'before.txt'), 'same bytes\n');
    await mkdir(path.join(dir, 'elsewhere'));
    const { connection, dispose } = await makeRuntime();

    try {
      await expect(
        connection.api.mutations.rename({
          from: runtimeRoot(path.join(dir, 'before.txt')),
          to: runtimeRoot(path.join(dir, 'after.txt')),
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(readFile(path.join(dir, 'after.txt'), 'utf8')).resolves.toBe('same bytes\n');

      await expect(
        connection.api.mutations.rename({
          from: runtimeRoot(path.join(dir, 'after.txt')),
          to: runtimeRoot(path.join(dir, 'elsewhere/after.txt')),
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
    } finally {
      await dispose();
    }
  });

  it('moves and copies across directories and pushes updates to live content models', async () => {
    const dir = await makeDir();
    await mkdir(path.join(dir, 'source'));
    await mkdir(path.join(dir, 'target'));
    await writeFile(path.join(dir, 'source/wandering.txt'), 'travels\n');
    const { connection, dispose } = await makeRuntime();
    const fromKey = { path: runtimeRoot(path.join(dir, 'source/wandering.txt')) };
    const toKey = { path: runtimeRoot(path.join(dir, 'target/wandering.txt')) };

    try {
      // Live content models on both endpoints must observe the move through the
      // published change notifications alone (the manual watcher never fires).
      await expect(
        connection.api.content.state(fromKey, 'content').snapshot()
      ).resolves.toMatchObject({ data: { kind: 'text', content: 'travels\n' } });
      await expect(
        connection.api.content.state(toKey, 'content').snapshot()
      ).resolves.toMatchObject({ data: { kind: 'unavailable', error: { type: 'not-found' } } });

      await expect(
        connection.api.mutations.move({ from: fromKey.path, to: toKey.path })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(readFile(path.join(dir, 'target/wandering.txt'), 'utf8')).resolves.toBe(
        'travels\n'
      );
      await waitFor(async () => {
        const gone = await connection.api.content.state(fromKey, 'content').snapshot();
        const arrived = await connection.api.content.state(toKey, 'content').snapshot();
        return gone.data.kind === 'unavailable' && arrived.data.kind === 'text';
      });

      await expect(
        connection.api.mutations.copy({
          from: toKey.path,
          to: runtimeRoot(path.join(dir, 'source/copied.txt')),
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(readFile(path.join(dir, 'source/copied.txt'), 'utf8')).resolves.toBe(
        'travels\n'
      );
      await expect(readFile(path.join(dir, 'target/wandering.txt'), 'utf8')).resolves.toBe(
        'travels\n'
      );
    } finally {
      await dispose();
    }
  });

  it('refuses to move onto an existing entry', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'a.txt'), 'a\n');
    await writeFile(path.join(dir, 'b.txt'), 'b\n');
    const { connection, dispose } = await makeRuntime();

    try {
      await expect(
        connection.api.mutations.move({
          from: runtimeRoot(path.join(dir, 'a.txt')),
          to: runtimeRoot(path.join(dir, 'b.txt')),
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'already-exists' } });
      await expect(readFile(path.join(dir, 'b.txt'), 'utf8')).resolves.toBe('b\n');
    } finally {
      await dispose();
    }
  });

  it('uploads bytes to a bare absolute path', async () => {
    const dir = await makeDir();
    const { connection, dispose } = await makeRuntime();

    try {
      const target = runtimeRoot(path.join(dir, 'uploaded.bin'));
      const bytes = Buffer.from('hi');
      const upload = await connection.api.fs.upload(
        { path: target },
        {
          name: 'uploaded.bin',
          mimeType: 'text/plain',
          size: bytes.byteLength,
          source: chunks(bytes),
        }
      );
      expect(upload).toEqual({ success: true, data: { bytesWritten: 2 } });
      await expect(readFile(path.join(dir, 'uploaded.bin'), 'utf8')).resolves.toBe('hi');

      await expect(
        connection.api.fs.upload(
          { path: target },
          {
            name: 'uploaded.bin',
            mimeType: 'text/plain',
            size: 1,
            source: chunks(Buffer.from('x')),
          }
        )
      ).resolves.toMatchObject({ success: false, error: { type: 'already-exists' } });
    } finally {
      await dispose();
    }
  });

  it('rejects mixed addressing modes at the seam', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'mixed.txt'), 'x\n');
    const { connection, dispose } = await makeRuntime();

    try {
      // A root-scoped call must use relative targets.
      await expect(
        connection.api.mutations.delete({
          root: runtimeRoot(dir),
          path: runtimeRoot(path.join(dir, 'mixed.txt')),
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      // A bare call must use absolute targets.
      await expect(
        connection.api.mutations.delete({ path: relativePath('mixed.txt') })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      // Rename endpoints must agree on the addressing mode.
      await expect(
        connection.api.mutations.rename({
          from: runtimeRoot(path.join(dir, 'mixed.txt')),
          to: relativePath('renamed.txt'),
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid-path' } });
      await expect(readFile(path.join(dir, 'mixed.txt'), 'utf8')).resolves.toBe('x\n');
    } finally {
      await dispose();
    }
  });

  it('keeps serving root-scoped mutations unchanged', async () => {
    const dir = await makeDir();
    const { connection, dispose } = await makeRuntime();

    try {
      await expect(
        connection.api.mutations.createFile({
          root: runtimeRoot(dir),
          path: relativePath('scoped.txt'),
          content: 'in root\n',
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(readFile(path.join(dir, 'scoped.txt'), 'utf8')).resolves.toBe('in root\n');

      await expect(
        connection.api.mutations.move({
          root: runtimeRoot(dir),
          from: relativePath('scoped.txt'),
          to: relativePath('moved.txt'),
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(readFile(path.join(dir, 'moved.txt'), 'utf8')).resolves.toBe('in root\n');
    } finally {
      await dispose();
    }
  });
});

async function* chunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

async function makeRuntime(options: FilesRuntimeOptions = {}) {
  const runtime = new FilesRuntime({
    watcher: options.watcher ?? new ManualWatcher(),
    idleTtlMs: 10_000,
    ...options,
  });
  const pair = memoryTransportPair();
  const controller = createFilesController(runtime);
  const stop = serve(pair.right, controller);
  return {
    connection: { api: client(filesContract, connect(pair.left)) },
    dispose: async () => {
      stop();
      controller.dispose?.();
      await runtime.dispose();
    },
  };
}

async function makeDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-files-mutations-')));
  roots.push(dir);
  return dir;
}

class ManualWatcher implements IWatchService {
  private readonly entries = new Map<
    string,
    { onEvents: (events: WatchEvent[]) => void; options: WatchOptions }
  >();

  watch(root: string, onEvents: (events: WatchEvent[]) => void, options: WatchOptions = {}) {
    this.entries.set(root, { onEvents, options });
    return {
      ready: async () => {},
      release: async () => {
        this.entries.delete(root);
      },
    };
  }

  async dispose(): Promise<void> {
    this.entries.clear();
  }
}

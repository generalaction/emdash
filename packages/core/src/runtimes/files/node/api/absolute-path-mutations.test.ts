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
  it('creates directories at bare absolute paths', async () => {
    const dir = await makeDir();
    const { connection, dispose } = await makeRuntime();

    try {
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
      await expect(readFile(path.join(dir, 'mixed.txt'), 'utf8')).resolves.toBe('x\n');
    } finally {
      await dispose();
    }
  });

  it('keeps serving root-scoped mutations unchanged', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'scoped.txt'), 'in root\n');
    const { connection, dispose } = await makeRuntime();

    try {
      await expect(
        connection.api.mutations.createDirectory({
          root: runtimeRoot(dir),
          path: relativePath('scoped-dir'),
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(stat(path.join(dir, 'scoped-dir'))).resolves.toMatchObject({});

      await expect(
        connection.api.mutations.delete({
          root: runtimeRoot(dir),
          path: relativePath('scoped.txt'),
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(stat(path.join(dir, 'scoped.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
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

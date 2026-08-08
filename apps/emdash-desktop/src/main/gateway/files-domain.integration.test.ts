import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  encodeResourceUri,
  hostFileRef,
  parseAbsolute,
  type ResourceUri,
} from '@emdash/core/primitives/path/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { createFilesController, FilesRuntime } from '@emdash/core/runtimes/files/node';
import type { IWatchService, WatchEvent, WatchOptions } from '@emdash/core/services/fs-watch/api';
import { ok } from '@emdash/shared';
import { waitFor } from '@emdash/shared/testing';
import { client, connect, encodeTopic, memoryTransportPair, serve } from '@emdash/wire/rpc';
import { afterEach, describe, expect, it } from 'vitest';
import { filesWireContract } from '@core/features/files/api';
import { createFilesWireController } from '@core/features/files/node/wire-controller';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

// Lives at the gateway layer because hosting a real files runtime requires the
// runtime's node surface, which feature slices must not import; the gateway is
// where the desktop wires slice controllers to hosted runtimes in production.
describe('files wire controller against a live files runtime', () => {
  it('serves live disk content with watch updates and etag-preconditioned writes', async () => {
    const { dir, watcher, controller } = await makeStack();
    const filePath = path.join(dir, 'draft.md');
    await writeFile(filePath, 'first\n');
    const key = { uri: localUri(filePath), source: 'disk' as const };
    const topic = encodeTopic(filesWireContract.content.states.content.id, key);

    const lease = controller.acquireLive(topic);
    const source = await lease?.ready();
    if (!source) throw new Error('Expected a live content source');
    try {
      const snapshot = await source.snapshot();
      expect(snapshot.data).toMatchObject({ kind: 'text', content: 'first\n' });
      const etag = (snapshot.data as { etag: string }).etag;

      // A disk change surfaces through the per-file parent-directory watch.
      await writeFile(filePath, 'changed on disk\n');
      watcher.emit(dir, [{ kind: 'update', path: filePath }]);
      await waitFor(async () => {
        const updated = (await source.snapshot()).data as { kind: string; content?: string };
        return updated.kind === 'text' && updated.content === 'changed on disk\n';
      });

      const fresh = await source.snapshot();
      const freshEtag = (fresh.data as { etag: string }).etag;
      await expect(
        controller.call('content.write', {
          key,
          input: {
            content: 'written over wire\n',
            precondition: { kind: 'etag', etag: freshEtag },
          },
          mutationId: 'mutation-1',
        })
      ).resolves.toMatchObject({ success: true });
      await expect(readFile(filePath, 'utf8')).resolves.toBe('written over wire\n');

      // A stale etag is rejected at the seam.
      await expect(
        controller.call('content.write', {
          key,
          input: { content: 'must not land\n', precondition: { kind: 'etag', etag } },
          mutationId: 'mutation-2',
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'etag-mismatch' } });
      await expect(readFile(filePath, 'utf8')).resolves.toBe('written over wire\n');
    } finally {
      await lease?.release();
    }
  });

  it('serves the tree live model keyed by root ResourceUri and exclusions', async () => {
    const { dir, controller } = await makeStack();
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src/index.ts'), 'export {};\n');
    await mkdir(path.join(dir, 'node_modules/pkg'), { recursive: true });
    const key = {
      root: localUri(dir),
      sessionId: 'session-1',
      exclusions: ['node_modules'],
    };
    const topic = encodeTopic(filesWireContract.tree.model.states.tree.id, key);

    const lease = controller.acquireLive(topic);
    const source = await lease?.ready();
    if (!source) throw new Error('Expected a live tree source');
    try {
      await expect(
        controller.call('tree.model.expand', { key, input: { path: '' }, mutationId: 'expand-1' })
      ).resolves.toMatchObject({ success: true });
      await waitFor(async () => {
        const snapshot = await source.snapshot();
        const entries = (snapshot.data as { entries: Record<string, unknown> }).entries;
        return 'src' in entries && !('node_modules' in entries);
      });
    } finally {
      await lease?.release();
    }
  });

  it('serves fs one-shots and file mutations keyed by ResourceUri', async () => {
    const { dir, controller } = await makeStack();
    await writeFile(path.join(dir, 'present.txt'), 'here\n');

    await expect(
      controller.call('fs.exists', { uri: localUri(path.join(dir, 'present.txt')) })
    ).resolves.toEqual(ok(true));
    await expect(
      controller.call('fs.exists', { uri: localUri(path.join(dir, 'absent.txt')) })
    ).resolves.toEqual(ok(false));
    await expect(
      controller.call('fs.readText', { uri: localUri(path.join(dir, 'present.txt')) })
    ).resolves.toMatchObject({ success: true, data: { content: 'here\n' } });

    await expect(
      controller.call('mutations.createDirectory', { uri: localUri(path.join(dir, 'docs')) })
    ).resolves.toEqual(ok(undefined));
    await expect(
      controller.call('mutations.createFile', {
        uri: localUri(path.join(dir, 'docs/note.md')),
        content: 'note\n',
      })
    ).resolves.toEqual(ok(undefined));
    await expect(readFile(path.join(dir, 'docs/note.md'), 'utf8')).resolves.toBe('note\n');

    await expect(
      controller.call('mutations.rename', {
        uri: localUri(path.join(dir, 'docs/note.md')),
        to: localUri(path.join(dir, 'docs/renamed.md')),
      })
    ).resolves.toEqual(ok(undefined));

    await expect(
      controller.call('mutations.move', {
        uri: localUri(path.join(dir, 'docs/renamed.md')),
        to: localUri(path.join(dir, 'moved.md')),
      })
    ).resolves.toEqual(ok(undefined));
    await expect(readFile(path.join(dir, 'moved.md'), 'utf8')).resolves.toBe('note\n');

    await expect(
      controller.call('mutations.delete', { uri: localUri(path.join(dir, 'moved.md')) })
    ).resolves.toEqual(ok(undefined));
    await expect(stat(path.join(dir, 'moved.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function makeStack() {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-files-wire-')));
  const watcher = new ManualWatcher();
  const runtime = new FilesRuntime({ watcher, idleTtlMs: 10_000 });
  const pair = memoryTransportPair();
  const runtimeController = createFilesController(runtime);
  const stop = serve(pair.right, runtimeController);
  const hostClient = { files: client(filesContract, connect(pair.left)) };
  const controller = createFilesWireController({
    runtimes: { client: async () => ok(hostClient as never) },
  });
  cleanups.push(async () => {
    stop();
    await runtimeController.dispose?.();
    await runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, watcher, controller };
}

function localUri(nativePath: string): ResourceUri {
  const parsed = parseAbsolute(nativePath, {
    profile: {
      style: path.sep === '\\' ? 'win32' : 'posix',
      unicodeNormalization: 'preserve',
    },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return encodeResourceUri(hostFileRef(LOCAL_HOST_REF, parsed.data));
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

  emit(root: string, events: WatchEvent[]): void {
    this.entries.get(root)?.onEvents(events);
  }

  async dispose(): Promise<void> {
    this.entries.clear();
  }
}

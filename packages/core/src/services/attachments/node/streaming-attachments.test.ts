import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deferred } from '@emdash/shared/testing';
import type { WireFile } from '@emdash/wire/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_BYTES, type AttachmentOwner } from '../api';
import { LocalAttachmentStore } from './local-attachment-store';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'emdash-owned-attachments-'));
  roots.push(root);
  return { root, store: new LocalAttachmentStore(root) };
}
function wireFile(source: AsyncIterable<Uint8Array>, extra: Partial<WireFile> = {}): WireFile {
  return {
    name: 'image.png',
    mimeType: 'image/png',
    stream: () => source,
    bytes: vi.fn(async () => {
      throw new Error('Must stream, not buffer');
    }),
    file: vi.fn(async () => {
      throw new Error('Must stream, not buffer');
    }),
    cancel: vi.fn(),
    ...extra,
  };
}
const bytes = async function* () {
  yield new Uint8Array([1, 2]);
  yield new Uint8Array([3]);
};
const conversation: AttachmentOwner = { kind: 'conversation', id: 'same-id' };
const workspace: AttachmentOwner = { kind: 'workspace', id: 'same-id' };

describe('streamed owner storage', () => {
  it('downloads in bounded chunks and closes on early or pre-read cancellation', async () => {
    const { store } = await setup();
    const payload = new Uint8Array(160_000).fill(7);
    const staged = await store.stage(
      workspace,
      wireFile(
        (async function* () {
          yield payload;
        })()
      )
    );
    const ref = await staged.publish();
    await staged.dispose();
    const downloaded = await store.get(workspace, ref.id);
    if (!downloaded) throw new Error('Missing attachment');
    const iterator = downloaded.source[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value.byteLength).toBe(64 * 1024);
    await iterator.return?.();
    expect((await iterator.next()).done).toBe(true);
    const cancelled = await store.get(workspace, ref.id);
    if (!cancelled) throw new Error('Missing attachment');
    const unopened = cancelled.source[Symbol.asyncIterator]();
    await unopened.return?.();
    expect((await unopened.next()).done).toBe(true);
    expect((await snapshot(store, workspace, ref.id))?.data).toEqual(payload);
  });

  it('publishes complete private files and separates equal ids of different owner kinds', async () => {
    const { store, root } = await setup();
    const staged = await store.stage(conversation, wireFile(bytes(), { size: 3 }));
    await expect(access(join(root, 'conversations/same-id'))).rejects.toThrow();
    const ref = await staged.publish();
    await staged.dispose();
    expect(await readFile(ref.targetPath)).toEqual(Buffer.from([1, 2, 3]));
    expect((await stat(ref.targetPath)).mode & 0o777).toBe(0o600);
    const directory = join(root, 'conversations/same-id', ref.id);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, 'metadata.json'))).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['content.png', 'metadata.json']);
    const other = await store.stage(workspace, wireFile(bytes()));
    const workspaceRef = await other.publish();
    await other.dispose();
    expect(await snapshot(store, workspace, ref.id)).toBeNull();
    await store.deleteOwner(conversation);
    expect(await snapshot(store, workspace, workspaceRef.id)).not.toBeNull();
  });

  it('never expires published files when another upload occurs', async () => {
    const { store } = await setup();
    const first = await store.stage(workspace, wireFile(bytes()));
    const ref = await first.publish();
    await first.dispose();
    await utimes(ref.targetPath, new Date(0), new Date(0));
    const next = await store.stage(workspace, wireFile(bytes()));
    await next.publish();
    await next.dispose();
    await expect(access(ref.targetPath)).resolves.toBeUndefined();
  });

  it('recovers only its worker namespace and never repeats cleanup during active uploads', async () => {
    const { root, store: conversations } = await setup();
    const workspaces = new LocalAttachmentStore(root);
    const liveShellUpload = await workspaces.stage(workspace, wireFile(bytes()));
    const old = await conversations.stage(conversation, wireFile(bytes()));
    const oldRef = await old.publish();
    await old.dispose();
    await utimes(oldRef.targetPath, new Date(0), new Date(0));
    await conversations.stage(conversation, wireFile(bytes())); // Simulate an abandoned upload.

    const restarted = new LocalAttachmentStore(root);
    await restarted.initialize('conversation');
    expect(await readdir(join(root, '.staging/conversation'))).toEqual([]);
    expect(await readdir(join(root, '.staging/workspace'))).toHaveLength(1);
    expect((await snapshot(restarted, conversation, oldRef.id))?.data).toEqual(
      new Uint8Array([1, 2, 3])
    );

    const live = await restarted.stage(conversation, wireFile(bytes()));
    await restarted.initialize('conversation');
    const next = await restarted.stage(conversation, wireFile(bytes()));
    expect(await readdir(join(root, '.staging/conversation'))).toHaveLength(2);
    await live.publish();
    await next.publish();
    await live.dispose();
    await next.dispose();
    const shellRef = await liveShellUpload.publish();
    await liveShellUpload.dispose();
    expect((await snapshot(workspaces, workspace, shellRef.id))?.data).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  it('does not publish disposed staging or publish an attachment twice', async () => {
    const { store } = await setup();
    const discarded = await store.stage(workspace, wireFile(bytes()));
    await discarded.dispose();
    await expect(discarded.publish()).rejects.toThrow('already consumed');
    const staged = await store.stage(workspace, wireFile(bytes()));
    const ref = await staged.publish();
    await expect(staged.publish()).rejects.toThrow('already consumed');
    await staged.dispose();
    await staged.dispose();
    expect((await snapshot(store, workspace, ref.id))?.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps an aborted staged attachment unpublished', async () => {
    const { store, root } = await setup();
    const abort = new AbortController();
    const staged = await store.stage(workspace, wireFile(bytes()), abort.signal);
    abort.abort();
    await expect(staged.publish()).rejects.toThrow();
    await staged.dispose();
    expect(await readdir(join(root, '.staging/workspace'))).toEqual([]);
    await expect(access(join(root, 'workspaces/same-id'))).rejects.toThrow();
  });

  it.each(['oversized', 'truncated', 'stream-failure'] as const)(
    'cleans staged bytes on %s',
    async (failure) => {
      const { store, root } = await setup();
      const file = wireFile(
        (async function* () {
          yield new Uint8Array([1]);
          if (failure === 'oversized') yield new Uint8Array(MAX_ATTACHMENT_BYTES);
          if (failure === 'stream-failure') throw new Error('source disconnected');
        })(),
        failure === 'truncated' ? { size: 10 } : {}
      );
      await expect(store.stage(workspace, file)).rejects.toThrow();
      expect(file.cancel).toHaveBeenCalledOnce();
      expect(await readdir(join(root, '.staging/workspace'))).toEqual([]);
      await expect(access(join(root, 'workspaces'))).rejects.toThrow();
    }
  );

  it('cancels an in-flight source and removes its staged file', async () => {
    const { store, root } = await setup();
    const abort = new AbortController();
    const started = deferred<void>();
    const stopped = deferred<void>();
    const file = wireFile(
      (async function* () {
        yield new Uint8Array([1]);
        started.resolve();
        await stopped.promise;
      })(),
      { cancel: vi.fn(() => stopped.resolve()) }
    );
    const pending = store.stage(workspace, file, abort.signal);
    await started.promise;
    abort.abort();
    await expect(pending).rejects.toThrow();
    expect(await readdir(join(root, '.staging/workspace'))).toEqual([]);
  });

  it('cleans failed publication without removing an existing destination', async () => {
    const { store, root } = await setup();
    const ownerDir = join(root, 'workspaces/same-id');
    const first = await store.stage(workspace, wireFile(bytes()));
    const [stagedName] = await readdir(join(root, '.staging/workspace'));
    const id = stagedName.slice(stagedName.lastIndexOf('.') + 1);
    const destination = join(ownerDir, id);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'existing'), 'keep');
    await expect(first.publish()).rejects.toThrow();
    await first.dispose();
    expect(await readdir(join(root, '.staging/workspace'))).toEqual([]);
    expect(await readFile(join(destination, 'existing'), 'utf8')).toBe('keep');
    const next = await store.stage(workspace, wireFile(bytes()));
    const ref = await next.publish();
    await next.dispose();
    expect((await snapshot(new LocalAttachmentStore(root), workspace, ref.id))?.data).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });
  it('owner deletion removes unfinished staged files while preserving other owners', async () => {
    const { root, store } = await setup();
    const abandoned = await store.stage(conversation, wireFile(bytes()));
    const other = await store.stage(workspace, wireFile(bytes()));
    expect(await readdir(join(root, '.staging/conversation'))).toHaveLength(1);
    expect(await readdir(join(root, '.staging/workspace'))).toHaveLength(1);
    await store.deleteOwner(conversation);
    expect(await readdir(join(root, '.staging/conversation'))).toEqual([]);
    expect(await readdir(join(root, '.staging/workspace'))).toHaveLength(1);
    const ref = await other.publish();
    await other.dispose();
    await abandoned.dispose();
    expect(await snapshot(store, workspace, ref.id)).not.toBeNull();
  });
});

async function snapshot(store: LocalAttachmentStore, owner: AttachmentOwner, id: string) {
  const value = await store.get(owner, id);
  if (!value) return null;
  const chunks: Uint8Array[] = [];
  for await (const chunk of value.source) chunks.push(chunk);
  return { ref: value.ref, data: new Uint8Array(Buffer.concat(chunks)) };
}

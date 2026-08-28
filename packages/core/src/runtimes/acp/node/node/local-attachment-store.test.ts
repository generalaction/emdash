import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAttachmentStore } from './local-attachment-store';

const CONV = 'conv-1';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'emdash-attachments-'));
  roots.push(root);
  return root;
}

function conversationDir(root: string, conversationId = CONV): string {
  return join(root, 'store', 'conversations', conversationId);
}

describe('LocalAttachmentStore', () => {
  it('snapshots uploaded bytes and returns their target Host path', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await store.put({
      conversationId: CONV,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      name: 'source.png',
    });
    const stored = await store.get(CONV, ref.id);

    expect(ref.targetPath).toBe(join(conversationDir(root), 'objects', `${ref.id}.png`));
    expect(stored).toEqual({
      ref,
      data: new Uint8Array([1, 2, 3]),
    });
    await expect(
      readFile(join(conversationDir(root), 'objects', `${ref.id}.png`))
    ).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it('copies uploaded bytes into the conversation directory', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));

    const ref = await store.put({
      conversationId: CONV,
      data: new Uint8Array([4, 5, 6]),
      mimeType: 'image/webp',
      name: 'copy.webp',
    });

    await expect(readFile(ref.targetPath!)).resolves.toEqual(Buffer.from([4, 5, 6]));
    await expect(store.get(CONV, ref.id)).resolves.toEqual({
      ref,
      data: new Uint8Array([4, 5, 6]),
    });
  });

  it('scopes attachments to their conversation', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));

    const ref = await store.put({
      conversationId: CONV,
      data: new Uint8Array([1]),
      mimeType: 'image/png',
      name: 'scoped.png',
    });

    await expect(store.get('conv-other', ref.id)).resolves.toBeNull();
    await expect(store.get(CONV, ref.id)).resolves.not.toBeNull();
  });

  it('persists the index across store instances', async () => {
    const root = await makeRoot();
    const storeDir = join(root, 'store');

    const ref = await new LocalAttachmentStore(storeDir).put({
      conversationId: CONV,
      data: new Uint8Array([7, 8, 9]),
      mimeType: 'image/jpeg',
      name: 'source.jpg',
    });

    await expect(new LocalAttachmentStore(storeDir).get(CONV, ref.id)).resolves.toEqual({
      ref,
      data: new Uint8Array([7, 8, 9]),
    });
  });

  it('deletes copied bytes for copy records', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await store.put({
      conversationId: CONV,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      name: 'copy.png',
    });

    await store.delete(CONV, ref.id);

    await expect(access(ref.targetPath!)).rejects.toThrow();
    await expect(store.get(CONV, ref.id)).resolves.toBeNull();
  });

  it('removes the whole conversation directory on conversation deletion', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await store.put({
      conversationId: CONV,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      name: 'copy.png',
    });
    const otherRef = await store.put({
      conversationId: 'conv-other',
      data: new Uint8Array([9]),
      mimeType: 'image/png',
      name: 'other.png',
    });

    await store.deleteConversation(CONV);

    await expect(access(conversationDir(root))).rejects.toThrow();
    await expect(store.get(CONV, ref.id)).resolves.toBeNull();
    // Other conversations are untouched.
    await expect(store.get('conv-other', otherRef.id)).resolves.not.toBeNull();
    // Idempotent for absent conversations.
    await expect(store.deleteConversation(CONV)).resolves.toBeUndefined();
    await expect(store.deleteConversation('never-existed')).resolves.toBeUndefined();
  });

  it('rejects path-like conversation ids', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));

    await expect(store.get('../escape', 'attachment-1')).rejects.toThrow(/Invalid conversation id/);
    await expect(store.deleteConversation('a/b')).rejects.toThrow(/Invalid conversation id/);
  });
});

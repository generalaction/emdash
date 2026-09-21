import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AttachmentOwner } from '../api';
import { LocalAttachmentStore } from './local-attachment-store';

const CONV = 'conv-1';
const owner = (id: string) => ({ kind: 'conversation' as const, id });
async function put(
  store: LocalAttachmentStore,
  input: { conversationId: string; data: Uint8Array; name: string; mimeType: string }
) {
  const staged = await store.stage(owner(input.conversationId), {
    name: input.name,
    mimeType: input.mimeType,
    size: input.data.length,
    stream: async function* () {
      yield input.data;
    },
    bytes: async () => input.data,
    file: async () => ({
      name: input.name,
      mimeType: input.mimeType,
      stream: async function* () {
        yield input.data;
      },
    }),
    cancel() {},
  });
  try {
    return await staged.publish();
  } finally {
    await staged.dispose();
  }
}

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
    const ref = await put(store, {
      conversationId: CONV,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      name: 'source.png',
    });
    const stored = await snapshot(store, owner(CONV), ref.id);

    expect(ref.targetPath).toBe(join(conversationDir(root), ref.id, 'content.png'));
    expect(stored).toEqual({
      ref,
      data: new Uint8Array([1, 2, 3]),
    });
    await expect(readFile(join(conversationDir(root), ref.id, 'content.png'))).resolves.toEqual(
      Buffer.from([1, 2, 3])
    );
  });

  it('copies uploaded bytes into the conversation directory', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));

    const ref = await put(store, {
      conversationId: CONV,
      data: new Uint8Array([4, 5, 6]),
      mimeType: 'image/webp',
      name: 'copy.webp',
    });

    await expect(readFile(ref.targetPath!)).resolves.toEqual(Buffer.from([4, 5, 6]));
    await expect(snapshot(store, owner(CONV), ref.id)).resolves.toEqual({
      ref,
      data: new Uint8Array([4, 5, 6]),
    });
  });

  it('scopes attachments to their conversation', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));

    const ref = await put(store, {
      conversationId: CONV,
      data: new Uint8Array([1]),
      mimeType: 'image/png',
      name: 'scoped.png',
    });

    await expect(snapshot(store, owner('conv-other'), ref.id)).resolves.toBeNull();
    await expect(snapshot(store, owner(CONV), ref.id)).resolves.not.toBeNull();
  });

  it('reads published metadata and bytes across store instances', async () => {
    const root = await makeRoot();
    const storeDir = join(root, 'store');

    const ref = await put(new LocalAttachmentStore(storeDir), {
      conversationId: CONV,
      data: new Uint8Array([7, 8, 9]),
      mimeType: 'image/jpeg',
      name: 'source.jpg',
    });

    await expect(
      snapshot(new LocalAttachmentStore(storeDir), owner(CONV), ref.id)
    ).resolves.toEqual({
      ref,
      data: new Uint8Array([7, 8, 9]),
    });
  });

  it('deletes an attachment and its metadata', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await put(store, {
      conversationId: CONV,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      name: 'copy.png',
    });

    await store.delete(owner(CONV), ref.id);

    await expect(access(ref.targetPath!)).rejects.toThrow();
    await expect(access(join(conversationDir(root), ref.id))).rejects.toThrow();
    await expect(snapshot(store, owner(CONV), ref.id)).resolves.toBeNull();
  });

  it('removes the whole conversation directory on conversation deletion', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await put(store, {
      conversationId: CONV,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      name: 'copy.png',
    });
    const otherRef = await put(store, {
      conversationId: 'conv-other',
      data: new Uint8Array([9]),
      mimeType: 'image/png',
      name: 'other.png',
    });

    await store.deleteOwner(owner(CONV));

    await expect(access(conversationDir(root))).rejects.toThrow();
    await expect(snapshot(store, owner(CONV), ref.id)).resolves.toBeNull();
    // Other conversations are untouched.
    await expect(snapshot(store, owner('conv-other'), otherRef.id)).resolves.not.toBeNull();
    // Idempotent for absent conversations.
    await expect(store.deleteOwner(owner(CONV))).resolves.toBeUndefined();
    await expect(store.deleteOwner(owner('never-existed'))).resolves.toBeUndefined();
  });

  it('rejects path-like conversation ids', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));

    await expect(
      Promise.resolve().then(() => snapshot(store, owner('../escape'), 'attachment-1'))
    ).rejects.toThrow(/Invalid/);
    await expect(Promise.resolve().then(() => store.deleteOwner(owner('a/b')))).rejects.toThrow(
      /Invalid/
    );
  });

  it('never resolves attachment ids as arbitrary paths', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await put(store, {
      conversationId: 'other',
      data: new Uint8Array([5]),
      name: 'image.png',
      mimeType: 'image/png',
    });
    for (const id of ['..', '../other', `../other/${ref.id}`, ref.targetPath, '..\\other', '']) {
      expect(await store.get(owner(CONV), id)).toBeNull();
      await store.delete(owner(CONV), id);
    }
    expect((await snapshot(store, owner('other'), ref.id))?.data).toEqual(new Uint8Array([5]));
  });

  it('derives content paths from safe names instead of trusting paths in metadata', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await put(store, {
      conversationId: CONV,
      data: new Uint8Array([1]),
      name: '../../image.png',
      mimeType: 'image/png',
    });
    const outside = join(root, 'outside.png');
    await writeFile(outside, 'outside');
    const metadataPath = join(conversationDir(root), ref.id, 'metadata.json');
    await writeFile(
      metadataPath,
      JSON.stringify({ ...ref, targetPath: outside, source: { storedPath: outside } })
    );
    expect((await snapshot(store, owner(CONV), ref.id))?.data).toEqual(new Uint8Array([1]));
    await store.delete(owner(CONV), ref.id);
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });

  it('rejects metadata for a different attachment and content symlinks', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await put(store, {
      conversationId: CONV,
      data: new Uint8Array([1]),
      name: 'image.png',
      mimeType: 'image/png',
    });
    const metadataPath = join(conversationDir(root), ref.id, 'metadata.json');
    const metadata = await readFile(metadataPath, 'utf8');
    await writeFile(
      metadataPath,
      JSON.stringify({ ...ref, id: '00000000-0000-4000-8000-000000000000' })
    );
    await expect(store.get(owner(CONV), ref.id)).rejects.toThrow('does not match');
    await writeFile(metadataPath, metadata);
    const outside = join(root, 'outside.png');
    await writeFile(outside, 'outside');
    await rm(ref.targetPath);
    await symlink(outside, ref.targetPath);
    await expect(store.get(owner(CONV), ref.id)).rejects.toThrow();
    await store.delete(owner(CONV), ref.id);
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });
});

async function snapshot(store: LocalAttachmentStore, owner: AttachmentOwner, id: string) {
  const value = await store.get(owner, id);
  if (!value) return null;
  const chunks: Uint8Array[] = [];
  for await (const chunk of value.source) chunks.push(chunk);
  return { ref: value.ref, data: new Uint8Array(Buffer.concat(chunks)) };
}

import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAttachmentStore } from './local-attachment-store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'emdash-attachments-'));
  roots.push(root);
  return root;
}

describe('LocalAttachmentStore', () => {
  it('stores references without copying original bytes', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'source.png');
    await writeFile(sourcePath, new Uint8Array([1, 2, 3]));

    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await store.put({
      originalPath: sourcePath,
      mimeType: 'image/png',
      name: 'source.png',
    });
    const stored = await store.get(ref.id);

    expect(stored).toEqual({
      ref,
      data: new Uint8Array([1, 2, 3]),
    });
    await expect(access(join(root, 'store', 'objects', ref.id))).rejects.toThrow();
  });

  it('copies uploaded bytes when no original path is provided', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));

    const ref = await store.put({
      data: new Uint8Array([4, 5, 6]),
      mimeType: 'image/webp',
      name: 'copy.webp',
    });

    await expect(readFile(join(root, 'store', 'objects', ref.id))).resolves.toEqual(
      Buffer.from([4, 5, 6])
    );
    await expect(store.get(ref.id)).resolves.toEqual({
      ref,
      data: new Uint8Array([4, 5, 6]),
    });
  });

  it('persists the index across store instances', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'source.jpg');
    await writeFile(sourcePath, new Uint8Array([7, 8, 9]));
    const storeDir = join(root, 'store');

    const ref = await new LocalAttachmentStore(storeDir).put({
      originalPath: sourcePath,
      mimeType: 'image/jpeg',
      name: 'source.jpg',
    });

    await expect(new LocalAttachmentStore(storeDir).get(ref.id)).resolves.toEqual({
      ref,
      data: new Uint8Array([7, 8, 9]),
    });
  });

  it('returns null when a referenced file disappears', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'source.gif');
    await writeFile(sourcePath, new Uint8Array([1]));
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await store.put({
      originalPath: sourcePath,
      mimeType: 'image/gif',
      name: 'source.gif',
    });

    await rm(sourcePath);

    await expect(store.get(ref.id)).resolves.toBeNull();
  });

  it('does not delete original files for reference records', async () => {
    const root = await makeRoot();
    const sourcePath = join(root, 'source.png');
    await writeFile(sourcePath, new Uint8Array([1, 2, 3]));
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await store.put({
      originalPath: sourcePath,
      mimeType: 'image/png',
      name: 'source.png',
    });

    await store.delete(ref.id);

    await expect(readFile(sourcePath)).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(store.get(ref.id)).resolves.toBeNull();
  });

  it('deletes copied bytes for copy records', async () => {
    const root = await makeRoot();
    const store = new LocalAttachmentStore(join(root, 'store'));
    const ref = await store.put({
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      name: 'copy.png',
    });

    await store.delete(ref.id);

    await expect(access(join(root, 'store', 'objects', ref.id))).rejects.toThrow();
    await expect(store.get(ref.id)).resolves.toBeNull();
  });
});

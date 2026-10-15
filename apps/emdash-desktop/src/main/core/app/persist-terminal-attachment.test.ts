import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupPersistedDroppedBlobs,
  persistDroppedBlobBytes,
  readClipboardForPaste,
  terminalFileSources,
} from './persist-terminal-attachment';

const mocks = vi.hoisted(() => ({
  temp: '',
  toPNG: vi.fn(() => Buffer.from([4, 5, 6])),
}));
vi.mock('electron', () => ({
  app: { getPath: () => mocks.temp, once: vi.fn() },
  clipboard: {},
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, toPNG: mocks.toPNG }) },
}));
beforeEach(async () => {
  mocks.temp = await mkdtemp(join(tmpdir(), 'terminal-source-'));
});
afterEach(async () => {
  await cleanupPersistedDroppedBlobs();
  await rm(mocks.temp, { recursive: true, force: true });
});

describe('desktop terminal file sources', () => {
  it('owns only app-generated temporary paths, regardless of the requested reference mode', async () => {
    const path = await persistDroppedBlobBytes({
      bytes: new Uint8Array([1, 2, 3]),
      name: 'paste.png',
    });
    const source = await terminalFileSources.prepare({ path, snapshot: false });
    expect(source).toMatchObject({ kind: 'path', path, snapshot: true, mimeType: 'image/png' });
    await source.dispose();
    await expect(access(path)).rejects.toThrow();
  });

  it('never deletes a user file, even when imported as a snapshot', async () => {
    const path = join(mocks.temp, 'original.png');
    await writeFile(path, 'original');
    const source = await terminalFileSources.prepare({ path, snapshot: true });
    await source.dispose();
    expect(await readFile(path, 'utf8')).toBe('original');
  });

  it('converts native HEIC to upload bytes in main and preserves the source', async () => {
    const path = join(mocks.temp, 'photo.heic');
    await writeFile(path, 'original');
    const source = await terminalFileSources.prepare({ path, snapshot: false });
    expect(source).toMatchObject({
      kind: 'bytes',
      name: 'photo.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([4, 5, 6]),
    });
    await source.dispose();
    expect(await readFile(path, 'utf8')).toBe('original');
  });
});

describe('readClipboardForPaste', () => {
  function fakeClipboard(text: string, png: number[]) {
    return {
      readText: vi.fn(() => text),
      readImage: vi.fn(
        () => ({ toPNG: () => Buffer.from(png) }) as unknown as Electron.NativeImage
      ),
    };
  }

  it('returns clipboard text without reading its image rendition', async () => {
    const clipboard = fakeClipboard('  cells\r\n', [1, 2, 3]);
    await expect(readClipboardForPaste('clipboard', clipboard)).resolves.toEqual({
      kind: 'text',
      text: '  cells\r\n',
    });
    expect(clipboard.readText).toHaveBeenCalledWith('clipboard');
    expect(clipboard.readImage).not.toHaveBeenCalled();
  });

  it('persists the image of an image-only clipboard as the snapshot', async () => {
    const clipboard = fakeClipboard('', [9, 8, 7]);
    const content = await readClipboardForPaste('clipboard', clipboard);
    expect(content.kind).toBe('image');
    const path = content.kind === 'image' ? content.path : '';
    expect(clipboard.readImage).toHaveBeenCalledWith('clipboard');
    expect([...(await readFile(path))]).toEqual([9, 8, 7]);
    // Later clipboard changes do not affect the snapshot that was persisted.
    clipboard.readImage.mockReturnValue({ toPNG: () => Buffer.from([0]) } as never);
    expect([...(await readFile(path))]).toEqual([9, 8, 7]);
  });

  it('reports an empty clipboard', async () => {
    await expect(readClipboardForPaste('clipboard', fakeClipboard('', []))).resolves.toEqual({
      kind: 'empty',
    });
  });

  it('reads the Linux primary selection only when asked to', async () => {
    const clipboard = fakeClipboard('primary text', []);
    await expect(readClipboardForPaste('selection', clipboard)).resolves.toEqual({
      kind: 'text',
      text: 'primary text',
    });
    expect(clipboard.readText).toHaveBeenCalledWith('selection');
  });
});

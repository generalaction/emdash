import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupPersistedDroppedBlobs,
  persistDroppedBlobBytes,
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

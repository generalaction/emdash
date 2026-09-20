import { readdirSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WireFile } from '@emdash/wire/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAbsolute } from '#primitives/path/api';
import { MAX_TEMPORARY_UPLOAD_BYTES } from '#runtimes/files/api';
import { TemporaryUploadStore } from './temporary-upload';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('TemporaryUploadStore', () => {
  it('streams into a private file and preserves an ordinary extension', async () => {
    const directory = await makeRoot();
    const store = new TemporaryUploadStore(directory);

    const result = await store.upload(wireFile('../../screen shot.PNG', ['hello', ' world']));

    expect(result.success).toBe(true);
    if (!result.success) return;
    const nativePath = formatAbsolute(result.data.path, { separator: path.sep as '/' | '\\' });
    expect(path.dirname(nativePath)).toBe(directory);
    expect(path.extname(nativePath)).toBe('.PNG');
    expect(path.basename(nativePath)).toMatch(/-upload\.PNG$/u);
    await expect(readFile(nativePath, 'utf8')).resolves.toBe('hello world');
    if (process.platform !== 'win32') {
      expect((await lstat(directory)).mode & 0o777).toBe(0o700);
      expect((await lstat(nativePath)).mode & 0o777).toBe(0o600);
    }
  });

  it('cancels and removes a partial upload when streamed bytes exceed the limit', async () => {
    const directory = await makeRoot();
    const cancel = vi.fn();
    const store = new TemporaryUploadStore(directory);
    const file = wireFile('image.png', [new Uint8Array(MAX_TEMPORARY_UPLOAD_BYTES + 1)], cancel);

    await expect(store.upload(file)).resolves.toMatchObject({
      success: false,
      error: { type: 'io', message: expect.stringContaining('maximum') },
    });
    expect(cancel).toHaveBeenCalledOnce();
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('removes a partial upload when the source stream fails', async () => {
    const directory = await makeRoot();
    const store = new TemporaryUploadStore(directory);
    const file = wireFile('image.png', ['partial'], undefined, new Error('stream failed'));

    await expect(store.upload(file)).resolves.toMatchObject({
      success: false,
      error: { type: 'io', message: expect.stringContaining('stream failed') },
    });
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('cancels and removes a partial upload when the caller aborts', async () => {
    const directory = await makeRoot();
    const store = new TemporaryUploadStore(directory);
    const controller = new AbortController();
    const cancel = vi.fn();
    const file = wireFile('image.png', ['partial'], cancel, undefined, () => {
      controller.abort(new Error('caller cancelled'));
    });

    await expect(store.upload(file, controller.signal)).resolves.toMatchObject({
      success: false,
      error: { type: 'io', message: expect.stringContaining('caller cancelled') },
    });
    expect(cancel).toHaveBeenCalledOnce();
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('cancels before streaming when the caller aborts as the staging file opens', async () => {
    const directory = await makeRoot();
    const controller = new AbortController();
    const cancel = vi.fn();
    const originalAddEventListener = controller.signal.addEventListener.bind(controller.signal);
    let stagedName: string | undefined;
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        stagedName = readdirSync(directory).find((name) => /\.partial$/u.test(name));
        if (stagedName) controller.abort(new Error('aborted during open'));
        originalAddEventListener(type, listener, options);
      }
    );
    const file = wireFile('image.partial', ['complete bytes'], cancel);
    const stream = vi.spyOn(file, 'stream');
    const store = new TemporaryUploadStore(directory);

    await expect(store.upload(file, controller.signal)).resolves.toMatchObject({
      success: false,
      error: { type: 'io', message: expect.stringContaining('aborted during open') },
    });
    expect(stagedName).toMatch(/\.partial$/u);
    expect(stream).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('removes the final file when the caller aborts as publication completes', async () => {
    const directory = await makeRoot();
    const controller = new AbortController();
    const cancel = vi.fn();
    const originalThrowIfAborted = controller.signal.throwIfAborted.bind(controller.signal);
    let publishedName: string | undefined;
    vi.spyOn(controller.signal, 'throwIfAborted').mockImplementation(() => {
      publishedName = readdirSync(directory).find((name) => /-upload(?:\.|$)/u.test(name));
      if (publishedName) controller.abort(new Error('aborted during rename'));
      originalThrowIfAborted();
    });
    const store = new TemporaryUploadStore(directory);

    await expect(
      store.upload(wireFile('image.partial', ['complete bytes'], cancel), controller.signal)
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'io', message: expect.stringContaining('aborted during rename') },
    });
    expect(publishedName).toMatch(/-upload(?:\.|$)/u);
    expect(cancel).toHaveBeenCalledOnce();
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('keeps a partial extension without colliding with the staging path', async () => {
    const directory = await makeRoot();
    const store = new TemporaryUploadStore(directory);

    const result = await store.upload(wireFile('capture.partial', ['complete']));

    expect(result.success).toBe(true);
    if (!result.success) return;
    const nativePath = formatAbsolute(result.data.path, { separator: path.sep as '/' | '\\' });
    expect(path.basename(nativePath)).toMatch(/-upload\.partial$/u);
    await expect(readFile(nativePath, 'utf8')).resolves.toBe('complete');
  });

  it('cleans only expired owned upload files without following symlinks', async () => {
    const directory = await makeRoot();
    const outside = path.join(await makeRoot(), 'outside.txt');
    const oldUpload = path.join(directory, '11111111-1111-4111-8111-111111111111-upload.png');
    const recentUpload = path.join(directory, '22222222-2222-4222-8222-222222222222-upload.png');
    const unrelated = path.join(directory, 'keep.txt');
    const linkedUpload = path.join(directory, '33333333-3333-4333-8333-333333333333-upload.png');
    const uploadLikeDirectory = path.join(
      directory,
      '44444444-4444-4444-8444-444444444444-upload.png'
    );
    await writeFile(oldUpload, 'old');
    await writeFile(recentUpload, 'recent');
    await writeFile(unrelated, 'unrelated');
    await writeFile(outside, 'outside');
    await symlink(outside, linkedUpload);
    await mkdir(uploadLikeDirectory);
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    await utimes(oldUpload, oldTime, oldTime);
    await utimes(uploadLikeDirectory, oldTime, oldTime);
    await chmod(directory, 0o700);
    const store = new TemporaryUploadStore(directory);

    const result = await store.upload(wireFile('next.txt', ['next']));

    expect(result.success).toBe(true);
    await expect(lstat(oldUpload)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(recentUpload, 'utf8')).resolves.toBe('recent');
    await expect(readFile(unrelated, 'utf8')).resolves.toBe('unrelated');
    expect((await lstat(linkedUpload)).isSymbolicLink()).toBe(true);
    expect((await lstat(uploadLikeDirectory)).isDirectory()).toBe(true);
    await expect(readFile(outside, 'utf8')).resolves.toBe('outside');
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-temporary-upload-test-'));
  roots.push(root);
  return root;
}

function wireFile(
  name: string,
  chunks: Iterable<string | Uint8Array>,
  cancel = vi.fn(),
  failure?: Error,
  afterChunks?: () => void
): WireFile {
  return {
    name,
    mimeType: 'application/octet-stream',
    size: 1,
    async *stream() {
      for (const chunk of chunks) {
        yield typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      }
      afterChunks?.();
      if (failure) throw failure;
    },
    async bytes() {
      throw new Error('Temporary uploads must stream');
    },
    async file() {
      throw new Error('Temporary uploads must stream');
    },
    cancel,
  };
}

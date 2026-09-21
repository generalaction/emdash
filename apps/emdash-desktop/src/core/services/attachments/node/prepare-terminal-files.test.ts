import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import { MAX_ATTACHMENT_BYTES, type AttachmentRef } from '@emdash/core/services/attachments/api';
import { err, ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import type { UploadFileValue } from '@emdash/wire/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareTerminalFiles, type TerminalFileSources } from './prepare-terminal-files';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'terminal-files-'));
  roots.push(root);
  const path = join(root, 'original name.txt');
  await writeFile(path, 'original');
  const source = { path, snapshot: false };
  const ref: AttachmentRef = {
    id: 'id',
    name: 'original name.txt',
    mimeType: 'text/plain',
    targetPath: '/remote/owned.txt',
    pathStyle: 'posix',
  };
  const upload = vi.fn(async (_file: UploadFileValue) => ok(ref));
  const remove = vi.fn(async (_id: string) => ok(undefined));
  const dispose = vi.fn(async () => {});
  const localFiles: TerminalFileSources = {
    prepare: async (input) => ({
      ...input,
      kind: 'path',
      name: 'original name.txt',
      mimeType: 'text/plain',
      dispose,
    }),
  };
  const options = {
    host: LOCAL_HOST_REF,
    sources: [source],
    localFiles,
    upload,
    remove,
    logger: noopLogger,
  };
  return { path, root, ref, options, dispose, upload, remove };
}

describe('main-side terminal file preparation', () => {
  it('cancels a native transfer before the remote requests any bytes', async () => {
    const { options, ref, dispose, remove } = await setup();
    options.sources[0].snapshot = true;
    const abort = new AbortController();
    const upload = vi.fn(async () => {
      abort.abort();
      // Let Node deliver stream events before the upload promise resolves.
      await new Promise<void>((resolve) => setImmediate(resolve));
      return ok(ref);
    });
    await expect(
      prepareTerminalFiles({ ...options, upload, signal: abort.signal })
    ).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledExactlyOnceWith(ref.id);
  });

  it('references an existing local file regardless of the upload cap and never owns it', async () => {
    const { path, options, upload, remove } = await setup();
    const handle = await open(path, 'r+');
    await handle.truncate(MAX_ATTACHMENT_BYTES + 1);
    await handle.close();
    const result = await prepareTerminalFiles(options);
    expect(result).toEqual(
      ok([
        {
          kind: 'reference',
          targetPath: path,
          pathStyle: process.platform === 'win32' ? 'win32' : 'posix',
        },
      ])
    );
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('streams desktop files straight to the remote owner with only file metadata', async () => {
    const { options, upload, ref, dispose, path } = await setup();
    upload.mockImplementation(async (file) => {
      if (!('source' in file)) throw new Error('Expected a stream');
      expect(Object.keys(file).sort()).toEqual(['mimeType', 'name', 'size', 'source']);
      const chunks = [];
      for await (const chunk of file.source as AsyncIterable<Uint8Array>) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe('original');
      return ok(ref);
    });
    expect(await prepareTerminalFiles({ ...options, host: hostRef('remote', 'remote') })).toEqual(
      ok([{ kind: 'attachment', ...ref }])
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(await readFile(path, 'utf8')).toBe('original');
  });

  it('imports temporary local snapshots instead of referencing their ephemeral paths', async () => {
    const { options, upload, ref } = await setup();
    options.sources[0].snapshot = true;
    expect(await prepareTerminalFiles(options)).toEqual(ok([{ kind: 'attachment', ...ref }]));
    expect(upload).toHaveBeenCalledOnce();
  });

  it('rejects oversized transfers and directories before uploading', async () => {
    const { options, upload, path, root } = await setup();
    const handle = await open(path, 'r+');
    await handle.truncate(MAX_ATTACHMENT_BYTES + 1);
    await handle.close();
    expect(
      await prepareTerminalFiles({ ...options, host: hostRef('remote', 'remote') })
    ).toMatchObject({ success: false, error: { message: expect.stringContaining('50 MB') } });
    const directory = join(root, 'directory');
    await mkdir(directory);
    expect(
      await prepareTerminalFiles({ ...options, sources: [{ path: directory, snapshot: false }] })
    ).toMatchObject({ success: false });
    expect(upload).not.toHaveBeenCalled();
  });

  it('rolls back only imported files on a later failure, preserving local originals', async () => {
    const { options, path, remove, ref } = await setup();
    const upload = vi
      .fn()
      .mockResolvedValueOnce(ok(ref))
      .mockResolvedValueOnce(err({ type: 'storage-failed', message: 'disk full' }));
    const result = await prepareTerminalFiles({
      ...options,
      upload,
      sources: [
        { path, snapshot: false },
        { path, snapshot: true },
        { path, snapshot: true },
      ],
    });
    expect(result).toMatchObject({ success: false, error: { message: 'disk full' } });
    expect(remove).toHaveBeenCalledExactlyOnceWith(ref.id);
    expect(await readFile(path, 'utf8')).toBe('original');
  });

  it('cleans up converted bytes and rolls back a late upload after cancellation', async () => {
    const { options, ref, remove, dispose } = await setup();
    const abort = new AbortController();
    const localFiles: TerminalFileSources = {
      prepare: async () => ({
        kind: 'bytes',
        bytes: new Uint8Array([1, 2, 3]),
        name: 'photo.png',
        mimeType: 'image/png',
        dispose,
      }),
    };
    const upload = vi.fn(async () => {
      abort.abort();
      return ok(ref);
    });
    await expect(
      prepareTerminalFiles({ ...options, localFiles, upload, signal: abort.signal })
    ).rejects.toThrow();
    expect(remove).toHaveBeenCalledExactlyOnceWith(ref.id);
    expect(dispose).toHaveBeenCalledOnce();
  });
});

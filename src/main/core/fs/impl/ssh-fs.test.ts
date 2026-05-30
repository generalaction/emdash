import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, FileListResult } from '../types';
import { SshFileSystem } from './ssh-fs';

type SftpMkdirError = Error & { code?: number };

function listResult(entries: FileEntry[]): FileListResult {
  return { entries, total: entries.length };
}

function fileEntry(path: string, mtimeMs: number, size = 1): FileEntry {
  return {
    path,
    type: 'file',
    size,
    mtime: new Date(mtimeMs),
    mode: 0o100644,
  };
}

function makeMkdirFs(errors: Array<SftpMkdirError | undefined>) {
  const mkdirCalls: string[] = [];
  const sftp = {
    on: vi.fn(),
    mkdir: vi.fn((dirPath: string, callback: (error?: SftpMkdirError) => void) => {
      mkdirCalls.push(dirPath);
      callback(errors.shift());
    }),
  };
  const proxy = {
    sftp: vi.fn((callback: (error: Error | undefined, sftp: unknown) => void) => {
      callback(undefined, sftp);
    }),
  };

  return {
    fs: new SshFileSystem(proxy as never, '/repo'),
    mkdirCalls,
  };
}

describe('SshFileSystem.mkdir', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats lowercase file exists as idempotent during recursive mkdir', async () => {
    const { fs } = makeMkdirFs([new Error('file exists')]);

    await expect(fs.mkdir('existing', { recursive: true })).resolves.toBeUndefined();
  });

  it('treats uppercase File exists as idempotent during recursive mkdir', async () => {
    const { fs } = makeMkdirFs([new Error('File exists')]);

    await expect(fs.mkdir('existing', { recursive: true })).resolves.toBeUndefined();
  });

  it('rejects non-EEXIST errors during recursive mkdir', async () => {
    const { fs } = makeMkdirFs([new Error('Permission denied')]);

    await expect(fs.mkdir('denied', { recursive: true })).rejects.toThrow('Permission denied');
  });

  it('creates missing parents when SFTP reports lowercase no such file', async () => {
    const { fs, mkdirCalls } = makeMkdirFs([new Error('no such file'), undefined, undefined]);

    await expect(fs.mkdir('parent/child', { recursive: true })).resolves.toBeUndefined();
    expect(mkdirCalls).toEqual(['/repo/parent/child', '/repo/parent', '/repo/parent/child']);
  });
});

describe('SshFileSystem.watch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits modify events when an existing polled file changes metadata', async () => {
    vi.useFakeTimers();

    const fs = new SshFileSystem({} as never, '/repo');
    vi.spyOn(fs, 'list')
      .mockResolvedValueOnce(listResult([fileEntry('notes.md', 1_000)]))
      .mockResolvedValueOnce(listResult([fileEntry('notes.md', 2_000)]));

    const events: Array<{ type: string; entryType: string; path: string }> = [];
    const watcher = fs.watch((batch) => events.push(...batch), { debounceMs: 10 });
    watcher.update(['']);

    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual([]);

    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual([{ type: 'modify', entryType: 'file', path: 'notes.md' }]);

    watcher.close();
  });
});

describe('SshFileSystem.copyLocalFileToTemp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses an atomically created remote temp directory', async () => {
    const fastPut = vi.fn((_local: string, _remote: string, cb: (error?: Error) => void) => cb());
    const fs = new SshFileSystem(
      {
        sftp: (cb: (error: Error | undefined, sftp: unknown) => void) =>
          cb(undefined, { fastPut, on: vi.fn() }),
      } as never,
      '/repo'
    );
    vi.spyOn(
      fs as unknown as {
        exec: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
      },
      'exec'
    )
      .mockResolvedValueOnce({
        stdout: '/tmp/emdash-initial-prompt-images-aBc123\n',
        stderr: '',
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    const remotePath = await fs.copyLocalFileToTemp('/tmp/local-image.png', 'local-image.png');

    expect(remotePath).toBe('/tmp/emdash-initial-prompt-images-aBc123/local-image.png');
    expect(remotePath).not.toContain('\n');
    expect(fastPut).toHaveBeenCalledWith('/tmp/local-image.png', remotePath, expect.any(Function));
  });
});

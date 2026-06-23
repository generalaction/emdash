import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, FileListResult } from '../types';
import { SshFileSystem } from './ssh-fs';

type SftpMkdirError = Error & { code?: number };
type SftpItem = {
  filename: string;
  attrs: {
    isDirectory: () => boolean;
    size: number;
    mtime: number;
    atime: number;
    mode: number;
  };
};

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

function makeListFs(rootPath: string, entriesByPath: Record<string, SftpItem[]>) {
  const sftp = {
    on: vi.fn(),
    readdir: vi.fn(
      (dirPath: string, callback: (error: Error | null, items: SftpItem[]) => void) => {
        callback(null, entriesByPath[dirPath] ?? []);
      }
    ),
  };
  const proxy = {
    sftp: vi.fn((callback: (error: Error | undefined, sftp: unknown) => void) => {
      callback(undefined, sftp);
    }),
  };

  return {
    fs: new SshFileSystem(proxy as never, rootPath),
    readdir: sftp.readdir,
  };
}

function sftpItem(filename: string, type: 'file' | 'dir'): SftpItem {
  return {
    filename,
    attrs: {
      isDirectory: () => type === 'dir',
      size: type === 'dir' ? 0 : 1,
      mtime: 1,
      atime: 1,
      mode: type === 'dir' ? 0o040755 : 0o100644,
    },
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

describe('SshFileSystem.list', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns relative paths when the remote root is /', async () => {
    const { fs } = makeListFs('/', {
      '/': [sftpItem('repo', 'dir')],
    });

    await expect(fs.list('', { includeHidden: true })).resolves.toMatchObject({
      entries: [{ path: 'repo', type: 'dir' }],
    });
  });

  it('returns relative nested paths when the remote root is /', async () => {
    const { fs } = makeListFs('/', {
      '/repo': [sftpItem('src', 'dir')],
    });

    await expect(fs.list('repo', { includeHidden: true })).resolves.toMatchObject({
      entries: [{ path: 'repo/src', type: 'dir' }],
    });
  });

  it('returns relative paths under a trailing-slash remote root', async () => {
    const { fs } = makeListFs('/repo/', {
      '/repo/src': [sftpItem('index.ts', 'file')],
    });

    await expect(fs.list('src', { includeHidden: true })).resolves.toMatchObject({
      entries: [{ path: 'src/index.ts', type: 'file' }],
    });
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

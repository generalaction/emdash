import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SshFileSystem } from './ssh-legacy-fs';
import { FileSystemErrorCodes, type FileEntry, type FileListResult } from './ssh-legacy-fs-types';

type SftpMkdirError = Error & { code?: number };
type SftpItem = {
  filename: string;
  attrs: {
    isDirectory: () => boolean;
    isFile: () => boolean;
    isSymbolicLink: () => boolean;
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
    readlink: vi.fn(
      (entryPath: string, callback: (error: Error | null, target: string) => void) => {
        callback(null, `${entryPath}-target`);
      }
    ),
    realpath: vi.fn((entryPath: string, callback: (error: Error | null, real: string) => void) => {
      callback(null, `${entryPath}-real`);
    }),
    stat: vi.fn(
      (entryPath: string, callback: (error: Error | null, stats: SftpItem['attrs']) => void) => {
        callback(null, sftpItem(basename(entryPath), 'file').attrs);
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

function makeRemoveFs() {
  const execCommands: string[] = [];
  const sftp = {
    on: vi.fn(),
    stat: vi.fn((_path: string, callback: (error: Error | undefined, stats?: unknown) => void) => {
      callback(undefined, {
        isDirectory: () => true,
        size: 0,
        mtime: 0,
        atime: 0,
        mode: 0o040755,
      });
    }),
  };
  const proxy = {
    sftp: vi.fn((callback: (error: Error | undefined, sftp: unknown) => void) => {
      callback(undefined, sftp);
    }),
    getRemoteShellProfile: vi.fn(async () => ({ shell: '/bin/sh', env: {} })),
    exec: vi.fn(
      (command: string, callback: (error: Error | undefined, stream: EventEmitter) => void) => {
        execCommands.push(command);
        const stream = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
        stream.stderr = new EventEmitter();
        callback(undefined, stream);
        setImmediate(() => stream.emit('close', 0));
      }
    ),
  };

  return {
    fs: new SshFileSystem(proxy as never, '/repo'),
    execCommands,
    proxy,
  };
}

function sftpItem(filename: string, type: 'file' | 'dir' | 'symlink'): SftpItem {
  return {
    filename,
    attrs: {
      isDirectory: () => type === 'dir',
      isFile: () => type === 'file',
      isSymbolicLink: () => type === 'symlink',
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

  it('preserves symlink entries from SFTP listings', async () => {
    const { fs } = makeListFs('/repo', {
      '/repo/': [sftpItem('linked-package', 'symlink')],
    });

    await expect(fs.list('', { includeHidden: true })).resolves.toMatchObject({
      entries: [
        {
          path: 'linked-package',
          type: 'symlink',
          symlink: {
            targetPath: '/repo/linked-package-target',
            realPath: '/repo/linked-package-real',
            targetType: 'file',
            broken: false,
          },
        },
      ],
    });
  });
});

function basename(value: string): string {
  const index = value.lastIndexOf('/');
  return index === -1 ? value : value.slice(index + 1);
}

describe('SshFileSystem.remove', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects traversal before recursive directory removal can reach SSH', async () => {
    const { fs, proxy } = makeRemoveFs();

    await expect(fs.remove('subdir/../../../outside', { recursive: true })).rejects.toMatchObject({
      code: FileSystemErrorCodes.PATH_ESCAPE,
    });

    expect(proxy.sftp).not.toHaveBeenCalled();
    expect(proxy.exec).not.toHaveBeenCalled();
  });

  it('removes directories recursively inside the workspace', async () => {
    const { fs, execCommands } = makeRemoveFs();

    await expect(fs.remove('subdir', { recursive: true })).resolves.toEqual({ success: true });

    expect(execCommands).toHaveLength(1);
    expect(execCommands[0]).toContain('rm -rf');
    expect(execCommands[0]).toContain('/repo/subdir');
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

  it('emits symlink watch entry types', async () => {
    vi.useFakeTimers();

    const fs = new SshFileSystem({} as never, '/repo');
    vi.spyOn(fs, 'list')
      .mockResolvedValueOnce(listResult([]))
      .mockResolvedValueOnce(
        listResult([
          {
            path: 'linked',
            type: 'symlink',
            size: 1,
            mtime: new Date(1_000),
            mode: 0o120755,
          },
        ])
      );

    const events: Array<{ type: string; entryType: string; path: string }> = [];
    const watcher = fs.watch((batch) => events.push(...batch), { debounceMs: 10 });
    watcher.update(['']);

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);

    expect(events).toEqual([{ type: 'create', entryType: 'symlink', path: 'linked' }]);
    watcher.close();
  });
});

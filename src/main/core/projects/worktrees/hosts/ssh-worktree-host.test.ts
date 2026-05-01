import { describe, expect, it, vi } from 'vitest';
import { FileSystemErrorCodes, type FileSystemProvider } from '@main/core/fs/types';
import { SshWorktreeHost } from './ssh-worktree-host';

function makeFs(): Pick<
  FileSystemProvider,
  'exists' | 'mkdir' | 'remove' | 'realPath' | 'glob' | 'copyFile' | 'stat'
> {
  return {
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue({ success: true }),
    realPath: vi.fn().mockResolvedValue('/real/path'),
    glob: vi.fn().mockResolvedValue(['.env']),
    copyFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue(null),
  };
}

describe('SshWorktreeHost', () => {
  it('delegates absolute POSIX paths to the wrapped filesystem', async () => {
    const fs = makeFs();
    const host = new SshWorktreeHost(fs);

    await host.mkdirAbsolute('/remote/worktrees/project', { recursive: true });
    await host.copyFileAbsolute('/remote/repo/.env', '/remote/worktrees/project/task/.env');
    await host.globAbsolute('.env', { cwd: '/remote/repo', dot: true });

    expect(fs.mkdir).toHaveBeenCalledWith('/remote/worktrees/project', { recursive: true });
    expect(fs.copyFile).toHaveBeenCalledWith(
      '/remote/repo/.env',
      '/remote/worktrees/project/task/.env'
    );
    expect(fs.glob).toHaveBeenCalledWith('.env', { cwd: '/remote/repo', dot: true });
  });

  it('rejects relative paths before delegating', async () => {
    const fs = makeFs();
    const host = new SshWorktreeHost(fs);

    await expect(host.existsAbsolute('relative/path')).rejects.toMatchObject({
      code: FileSystemErrorCodes.INVALID_PATH,
    });
    expect(fs.exists).not.toHaveBeenCalled();
  });
});

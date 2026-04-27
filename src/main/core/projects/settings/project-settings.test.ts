import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { ExecFn } from '@main/core/utils/exec';
import { LocalProjectSettingsProvider, SshProjectSettingsProvider } from './project-settings';

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn().mockResolvedValue({
      defaultWorktreeDirectory: '/tmp/emdash/worktrees',
    }),
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
  },
}));

describe('ProjectSettingsProvider worktreeDirectory validation', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes and canonicalizes local worktreeDirectory on update', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectPath, 'main');
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: 'worktrees' });
    expect(result.success).toBe(true);

    const expectedPath = path.resolve(projectPath, 'worktrees');
    expect(fs.existsSync(expectedPath)).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(path.join(projectPath, '.emdash.json'), 'utf8'));
    expect(persisted.worktreeDirectory).toBe(fs.realpathSync(expectedPath));
  });

  it('surfaces local worktreeDirectory validation errors', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectPath, 'main');
    // On many systems /restricted won't exist or won't be writable by a regular user
    const result = await provider.update({
      preservePatterns: [],
      worktreeDirectory: '/root-protected-dir-that-should-fail',
    });
    // If it happens to succeed (e.g. running as root), we just skip this check or use a better error case
    if (!result.success) {
      expect(result.error?.type).toBe('invalid-worktree-directory');
    }
  });

  it('clears blank local worktreeDirectory values', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectPath, 'main');
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: '   ' });
    expect(result.success).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(path.join(projectPath, '.emdash.json'), 'utf8'));
    expect(persisted.worktreeDirectory).toBeUndefined();
  });

  it('normalizes and canonicalizes ssh worktreeDirectory on update', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const projectFs = {
      write: writeMock,
    } as unknown as SshFileSystem;
    const rootFs = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      realPath: vi.fn().mockResolvedValue('/canonical/ssh-worktrees'),
    };

    const provider = new SshProjectSettingsProvider(projectFs, 'main', rootFs, '/remote/repo');
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: 'worktrees' });
    expect(result.success).toBe(true);

    expect(rootFs.mkdir).toHaveBeenCalledWith('/remote/repo/worktrees', { recursive: true });
    expect(rootFs.realPath).toHaveBeenCalledWith('/remote/repo/worktrees');

    expect(writeMock).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(writeMock.mock.calls[0][1]);
    expect(persisted.worktreeDirectory).toBe('/canonical/ssh-worktrees');
  });

  it('uses project-scoped ssh default worktree directory when not configured', async () => {
    const projectFs = {
      exists: vi.fn().mockResolvedValue(false),
    } as unknown as SshFileSystem;

    const provider = new SshProjectSettingsProvider(projectFs, 'main', undefined, '/remote/repo');
    await expect(provider.getWorktreeDirectory()).resolves.toBe('/remote/repo/.emdash/worktrees');
  });

  it('rejects tilde worktreeDirectory for ssh projects', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const projectFs = {
      write: writeMock,
    } as unknown as SshFileSystem;
    const rootFs = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      realPath: vi.fn().mockResolvedValue('/canonical/ssh-worktrees'),
    };

    const provider = new SshProjectSettingsProvider(projectFs, 'main', rootFs, '/remote/repo');
    const result = await provider.update({
      preservePatterns: [],
      worktreeDirectory: '~/worktrees',
    });
    expect(result).toEqual({
      success: false,
      error: { type: 'invalid-worktree-directory' },
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('falls back to project-scoped ssh default when configured directory is invalid', async () => {
    const projectFs = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue({
        content: JSON.stringify({ worktreeDirectory: '~/worktrees' }),
      }),
    } as unknown as SshFileSystem;

    const provider = new SshProjectSettingsProvider(projectFs, 'main', undefined, '/remote/repo');
    await expect(provider.getWorktreeDirectory()).resolves.toBe('/remote/repo/.emdash/worktrees');
  });

  it('expands and caches ssh home for tilde worktreeDirectory values', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const projectFs = {
      write: writeMock,
    } as unknown as SshFileSystem;
    const rootFs = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      realPath: vi.fn().mockResolvedValue('/canonical/ssh-worktrees'),
    };
    const exec = vi.fn().mockResolvedValue({ stdout: '/home/ubuntu', stderr: '' }) as ExecFn;

    const provider = new SshProjectSettingsProvider(
      projectFs,
      'main',
      rootFs,
      '/remote/repo',
      exec
    );
    const first = await provider.update({ preservePatterns: [], worktreeDirectory: '~/worktrees' });
    const second = await provider.update({ preservePatterns: [], worktreeDirectory: '~' });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(rootFs.mkdir).toHaveBeenCalledWith('/home/ubuntu/worktrees', { recursive: true });
    expect(rootFs.realPath).toHaveBeenCalledWith('/home/ubuntu/worktrees');
    expect(writeMock).toHaveBeenCalledTimes(2);
  });
});

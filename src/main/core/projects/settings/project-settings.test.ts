import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRESERVE_PATTERNS } from '@shared/project-settings';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { LocalProjectSettingsProvider, SshProjectSettingsProvider } from './project-settings';
import type { ProjectSettingsStorage } from './project-settings-storage';

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'projects') return Promise.resolve({ tmuxByDefault: false });
      return Promise.resolve({
        defaultWorktreeDirectory: '/tmp/emdash/worktrees',
      });
    }),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
  },
}));

describe('ProjectSettingsProvider worktreeDirectory validation', () => {
  const tempDirs: string[] = [];
  const storage = (): ProjectSettingsStorage => {
    const rows = new Map<
      string,
      {
        baseProjectSettingsJson: string;
        shareableProjectSettingsJson: string;
        legacyConfigMigratedAt: string | null;
      }
    >();
    return {
      get: async (projectId) => rows.get(projectId),
      insertIfMissing: async (projectId, settings) => {
        if (!rows.has(projectId)) rows.set(projectId, settings);
      },
      update: async (projectId, settings) => {
        rows.set(projectId, { ...rows.get(projectId)!, ...settings });
      },
    };
  };

  const projectId = () => `project-${randomUUID()}`;

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds default preserve patterns when the repo has no shared config', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', storage());

    await expect(provider.get()).resolves.toMatchObject({
      preservePatterns: [...DEFAULT_PRESERVE_PATTERNS],
    });
  });

  it('seeds default preserve patterns when shared config omits preservePatterns', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    fs.writeFileSync(
      path.join(projectPath, '.emdash.json'),
      JSON.stringify({ shellSetup: 'nvm use' })
    );

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', storage());

    await expect(provider.get()).resolves.toMatchObject({
      preservePatterns: [...DEFAULT_PRESERVE_PATTERNS],
    });
  });

  it('does not seed default preserve patterns when shared config defines preservePatterns', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    fs.writeFileSync(
      path.join(projectPath, '.emdash.json'),
      JSON.stringify({ preservePatterns: ['.env.shared'] })
    );

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', storage());

    await expect(provider.get()).resolves.not.toHaveProperty('preservePatterns');
  });

  it('retries legacy config migration after a failed attempt', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    const row = {
      baseProjectSettingsJson: '{}',
      shareableProjectSettingsJson: '{}',
      legacyConfigMigratedAt: null,
    };
    let updateAttempts = 0;
    const settingsStorage: ProjectSettingsStorage = {
      get: async () => row,
      insertIfMissing: vi.fn(),
      update: async (_projectId, settings) => {
        updateAttempts += 1;
        if (updateAttempts === 1) throw new Error('db write failed');
        Object.assign(row, settings);
      },
    };
    const provider = new LocalProjectSettingsProvider(
      projectId(),
      projectPath,
      'main',
      settingsStorage
    );

    await expect(provider.ensure()).rejects.toThrow('db write failed');
    await expect(provider.ensure()).resolves.toBeUndefined();
    await expect(provider.ensure()).resolves.toBeUndefined();

    expect(updateAttempts).toBe(2);
  });

  it('normalizes and canonicalizes local worktreeDirectory on update', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', storage());
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: 'worktrees' });
    expect(result.success).toBe(true);

    const expectedPath = path.resolve(projectPath, 'worktrees');
    expect(fs.existsSync(expectedPath)).toBe(true);

    await expect(provider.get()).resolves.toMatchObject({
      worktreeDirectory: fs.realpathSync(expectedPath),
    });
  });

  it('surfaces local worktreeDirectory validation errors', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    fs.writeFileSync(path.join(projectPath, 'not-a-directory'), 'file');

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', storage());
    const result = await provider.update({
      preservePatterns: [],
      worktreeDirectory: path.join(projectPath, 'not-a-directory', 'worktrees'),
    });
    expect(result).toEqual({
      success: false,
      error: { type: 'invalid-worktree-directory' },
    });
  });

  it('clears blank local worktreeDirectory values', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', storage());
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: '   ' });
    expect(result.success).toBe(true);

    await expect(provider.get()).resolves.not.toHaveProperty('worktreeDirectory');
  });

  it('normalizes and canonicalizes ssh worktreeDirectory on update', async () => {
    const projectFs = {
      exists: vi.fn().mockResolvedValue(false),
    } as unknown as SshFileSystem;
    const rootFs = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      realPath: vi.fn().mockResolvedValue('/canonical/ssh-worktrees'),
    };

    const provider = new SshProjectSettingsProvider(
      projectId(),
      projectFs,
      'main',
      rootFs,
      '/remote/repo',
      undefined,
      storage()
    );
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: 'worktrees' });
    expect(result.success).toBe(true);

    expect(rootFs.mkdir).toHaveBeenCalledWith('/remote/repo/worktrees', { recursive: true });
    expect(rootFs.realPath).toHaveBeenCalledWith('/remote/repo/worktrees');

    await expect(provider.get()).resolves.toMatchObject({
      worktreeDirectory: '/canonical/ssh-worktrees',
    });
  });

  it('uses project-scoped ssh default worktree directory when not configured', async () => {
    const projectFs = {
      exists: vi.fn().mockResolvedValue(false),
    } as unknown as SshFileSystem;

    const provider = new SshProjectSettingsProvider(
      projectId(),
      projectFs,
      'main',
      undefined,
      '/remote/repo',
      undefined,
      storage()
    );
    await expect(provider.getWorktreeDirectory()).resolves.toBe('/remote/repo/.emdash/worktrees');
  });

  it('rejects tilde worktreeDirectory for ssh projects', async () => {
    const projectFs = {
      exists: vi.fn().mockResolvedValue(false),
    } as unknown as SshFileSystem;
    const rootFs = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      realPath: vi.fn().mockResolvedValue('/canonical/ssh-worktrees'),
    };

    const provider = new SshProjectSettingsProvider(
      projectId(),
      projectFs,
      'main',
      rootFs,
      '/remote/repo',
      undefined,
      storage()
    );
    const result = await provider.update({
      preservePatterns: [],
      worktreeDirectory: '~/worktrees',
    });
    expect(result).toEqual({
      success: false,
      error: { type: 'invalid-worktree-directory' },
    });
  });

  it('falls back to project-scoped ssh default when configured directory is invalid', async () => {
    const projectFs = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue({
        content: JSON.stringify({ worktreeDirectory: '~/worktrees' }),
      }),
    } as unknown as SshFileSystem;

    const provider = new SshProjectSettingsProvider(
      projectId(),
      projectFs,
      'main',
      undefined,
      '/remote/repo',
      undefined,
      storage()
    );
    await expect(provider.getWorktreeDirectory()).resolves.toBe('/remote/repo/.emdash/worktrees');
  });

  it('expands and caches ssh home for tilde worktreeDirectory values', async () => {
    const projectFs = {
      exists: vi.fn().mockResolvedValue(false),
    } as unknown as SshFileSystem;
    const rootFs = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      realPath: vi.fn().mockResolvedValue('/canonical/ssh-worktrees'),
    };
    const ctx = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn().mockResolvedValue({ stdout: '/home/ubuntu', stderr: '' }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IExecutionContext;

    const provider = new SshProjectSettingsProvider(
      projectId(),
      projectFs,
      'main',
      rootFs,
      '/remote/repo',
      ctx,
      storage()
    );
    const first = await provider.update({ preservePatterns: [], worktreeDirectory: '~/worktrees' });
    const second = await provider.update({ preservePatterns: [], worktreeDirectory: '~' });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    expect(ctx.exec).toHaveBeenCalledTimes(1);
    expect(rootFs.mkdir).toHaveBeenCalledWith('/home/ubuntu/worktrees', { recursive: true });
    expect(rootFs.realPath).toHaveBeenCalledWith('/home/ubuntu/worktrees');
  });
});

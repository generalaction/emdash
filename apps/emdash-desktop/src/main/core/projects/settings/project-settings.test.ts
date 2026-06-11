import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IExecutionContext } from '@emdash/shared/exec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { DEFAULT_PRESERVE_PATTERNS } from '@shared/core/project-settings/project-settings';
import type { ProjectSettingsStorage } from './project-settings-storage';
import { LocalProjectSettingsProvider } from './providers/local-project-settings-provider';
import { SshProjectSettingsProvider } from './providers/ssh-project-settings-provider';

const storageMockState = vi.hoisted(() => ({
  storage: undefined as ProjectSettingsStorage | undefined,
}));

function makeTrackingGit(isFileCleanlyTracked: boolean) {
  return {
    isFileCleanlyTracked: vi.fn().mockResolvedValue(isFileCleanlyTracked),
  };
}

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'project') return Promise.resolve({ tmuxByDefault: false });
      return Promise.resolve({
        defaultWorktreeDirectory: '/tmp/emdash/worktrees',
      });
    }),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('./project-settings-storage', () => ({
  ProjectSettingsRepository: vi.fn(function ProjectSettingsRepository() {
    if (!storageMockState.storage) {
      throw new Error('ProjectSettingsRepository test storage was not configured');
    }
    return storageMockState.storage;
  }),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
  },
}));

describe('ProjectSettingsProvider worktreeDirectory validation', () => {
  const tempDirs: string[] = [];
  const createStorage = (): ProjectSettingsStorage => {
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

  beforeEach(() => {
    storageMockState.storage = createStorage();
  });

  afterEach(() => {
    storageMockState.storage = undefined;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds default preserve patterns when the repo has no shared config', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

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

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

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

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

    await expect(provider.get()).resolves.not.toHaveProperty('preservePatterns');
  });

  it('migrates shareable settings from a local-only root config', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    fs.writeFileSync(
      path.join(projectPath, '.emdash.json'),
      JSON.stringify({
        preservePatterns: ['.env.local'],
        shellSetup: 'nvm use',
        scripts: {
          setup: 'pnpm install',
          run: 'pnpm dev',
          teardown: 'pnpm cleanup',
        },
      })
    );

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', {
      git: makeTrackingGit(false),
    });

    await expect(provider.get()).resolves.toMatchObject({
      preservePatterns: ['.env.local'],
      shellSetup: 'nvm use',
      scripts: {
        setup: 'pnpm install',
        run: 'pnpm dev',
        teardown: 'pnpm cleanup',
      },
    });
  });

  it('migrates local-only shareable settings for rows already base-migrated', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    fs.writeFileSync(
      path.join(projectPath, '.emdash.json'),
      JSON.stringify({
        shellSetup: 'nvm use',
        scripts: {
          setup: 'pnpm install',
          run: 'pnpm dev',
        },
      })
    );
    const row = {
      baseProjectSettingsJson: JSON.stringify({ defaultBranch: 'main' }),
      shareableProjectSettingsJson: '{}',
      legacyConfigMigratedAt: new Date().toISOString(),
    };
    const settingsStorage: ProjectSettingsStorage = {
      get: async () => row,
      insertIfMissing: vi.fn(),
      update: async (_projectId, settings) => {
        Object.assign(row, settings);
      },
    };
    storageMockState.storage = settingsStorage;
    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', {
      git: makeTrackingGit(false),
    });

    await expect(provider.get()).resolves.toMatchObject({
      shellSetup: 'nvm use',
      scripts: {
        setup: 'pnpm install',
        run: 'pnpm dev',
      },
    });

    const result = await provider.update({ preservePatterns: [] });
    expect(result.success).toBe(true);
    await expect(provider.get()).resolves.not.toHaveProperty('shellSetup');
    await expect(provider.get()).resolves.not.toHaveProperty('scripts');
  });

  it('keeps cleanly tracked shareable settings file-backed', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    fs.writeFileSync(
      path.join(projectPath, '.emdash.json'),
      JSON.stringify({
        shellSetup: 'nvm use',
        scripts: {
          setup: 'pnpm install',
          run: 'pnpm dev',
        },
      })
    );

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main', {
      git: makeTrackingGit(true),
    });

    await expect(provider.get()).resolves.toMatchObject({
      preservePatterns: [...DEFAULT_PRESERVE_PATTERNS],
    });
    await expect(provider.get()).resolves.not.toHaveProperty('shellSetup');
    await expect(provider.get()).resolves.not.toHaveProperty('scripts');
  });

  it('does not seed computed worktreeDirectory into project settings', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

    await expect(provider.get()).resolves.not.toHaveProperty('worktreeDirectory');
    await expect(provider.getDefaultWorktreeDirectory()).resolves.toBe('/tmp/emdash/worktrees');
    await expect(provider.getWorktreeDirectory()).resolves.toBe('/tmp/emdash/worktrees');
  });

  it('migrates legacy remote setting to baseRemote', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    const row = {
      baseProjectSettingsJson: JSON.stringify({ remote: 'upstream' }),
      shareableProjectSettingsJson: '{}',
      legacyConfigMigratedAt: null,
    };
    const settingsStorage: ProjectSettingsStorage = {
      get: async () => row,
      insertIfMissing: vi.fn(),
      update: async (_projectId, settings) => {
        Object.assign(row, settings);
      },
    };
    storageMockState.storage = settingsStorage;
    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

    await expect(provider.get()).resolves.toMatchObject({ baseRemote: 'upstream' });
    expect(JSON.parse(row.baseProjectSettingsJson)).toEqual({ baseRemote: 'upstream' });
  });

  it('keeps computed worktreeDirectory default separate from configured overrides', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');
    const expectedOverridePath = path.resolve(projectPath, 'worktrees');
    const result = await provider.update({
      preservePatterns: [],
      worktreeDirectory: expectedOverridePath,
    });
    expect(result.success).toBe(true);

    const expectedOverride = fs.realpathSync(expectedOverridePath);
    await expect(provider.get()).resolves.toMatchObject({ worktreeDirectory: expectedOverride });
    await expect(provider.getDefaultWorktreeDirectory()).resolves.toBe('/tmp/emdash/worktrees');
    await expect(provider.getWorktreeDirectory()).resolves.toBe(expectedOverride);
  });

  it('stores the selected GitHub account as base project settings', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

    const result = await provider.update({
      preservePatterns: [],
      githubAccountId: 'github.com:42',
    });

    expect(result.success).toBe(true);
    await expect(provider.get()).resolves.toMatchObject({ githubAccountId: 'github.com:42' });
  });

  it('stores null GitHub account selection as an explicit project override', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

    const result = await provider.update({
      preservePatterns: [],
      githubAccountId: null,
    });

    expect(result.success).toBe(true);
    await expect(provider.get()).resolves.toMatchObject({ githubAccountId: null });
  });

  it('patches the selected GitHub account without replacing other base settings', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    const row = {
      baseProjectSettingsJson: JSON.stringify({
        defaultBranch: 'develop',
        baseRemote: 'upstream',
        tmux: true,
      }),
      shareableProjectSettingsJson: JSON.stringify({
        preservePatterns: ['.env.local'],
      }),
      legacyConfigMigratedAt: new Date().toISOString(),
    };
    const settingsStorage: ProjectSettingsStorage = {
      get: async () => row,
      insertIfMissing: vi.fn(),
      update: async (_projectId, settings) => {
        Object.assign(row, settings);
      },
    };
    storageMockState.storage = settingsStorage;
    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

    const result = await provider.patch({ githubAccountId: 'github.com:42' });

    expect(result.success).toBe(true);
    expect(JSON.parse(row.baseProjectSettingsJson)).toEqual({
      defaultBranch: 'develop',
      baseRemote: 'upstream',
      githubAccountId: 'github.com:42',
      tmux: true,
    });
    await expect(provider.get()).resolves.toMatchObject({
      defaultBranch: 'develop',
      baseRemote: 'upstream',
      githubAccountId: 'github.com:42',
      preservePatterns: ['.env.local'],
      tmux: true,
    });
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
    storageMockState.storage = settingsStorage;
    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

    await expect(provider.ensure()).rejects.toThrow('db write failed');
    await expect(provider.ensure()).resolves.toBeUndefined();
    await expect(provider.ensure()).resolves.toBeUndefined();

    expect(updateAttempts).toBe(2);
  });

  it('clears shareable fields without validating base settings', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    const row = {
      baseProjectSettingsJson: JSON.stringify({
        worktreeDirectory: path.join(projectPath, 'not-yet-created'),
      }),
      shareableProjectSettingsJson: JSON.stringify({
        preservePatterns: ['.env'],
        scripts: {
          setup: 'pnpm install',
          run: 'pnpm dev',
        },
      }),
      legacyConfigMigratedAt: new Date().toISOString(),
    };
    const settingsStorage: ProjectSettingsStorage = {
      get: async () => row,
      insertIfMissing: vi.fn(),
      update: async (_projectId, settings) => {
        Object.assign(row, settings);
      },
    };
    storageMockState.storage = settingsStorage;
    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');

    const result = await provider.patch({
      clearShareableFields: ['preservePatterns', 'scripts.run'],
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(row.shareableProjectSettingsJson)).toEqual({
      scripts: {
        setup: 'pnpm install',
      },
    });
  });

  it('normalizes and canonicalizes local absolute worktreeDirectory on update', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');
    const expectedPath = path.resolve(projectPath, 'worktrees');
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: expectedPath });
    expect(result.success).toBe(true);

    expect(fs.existsSync(expectedPath)).toBe(true);

    await expect(provider.get()).resolves.toMatchObject({
      worktreeDirectory: fs.realpathSync(expectedPath),
    });
  });

  it('rejects local relative worktreeDirectory values', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: 'worktrees' });

    expect(result).toEqual({
      success: false,
      error: { type: 'invalid-worktree-directory' },
    });
  });

  it('rejects foreign absolute worktreeDirectory values for local projects', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');
    const foreignPath = process.platform === 'win32' ? '/tmp/worktrees' : 'C:\\worktrees';
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: foreignPath });

    expect(result).toEqual({
      success: false,
      error: { type: 'invalid-worktree-directory' },
    });
  });

  it('surfaces local worktreeDirectory validation errors', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    fs.writeFileSync(path.join(projectPath, 'not-a-directory'), 'file');

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');
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

    const provider = new LocalProjectSettingsProvider(projectId(), projectPath, 'main');
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: '   ' });
    expect(result.success).toBe(true);

    await expect(provider.get()).resolves.not.toHaveProperty('worktreeDirectory');
  });

  it('normalizes and canonicalizes ssh absolute worktreeDirectory on update', async () => {
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
      undefined
    );
    const result = await provider.update({
      preservePatterns: [],
      worktreeDirectory: '/remote/repo/worktrees',
    });
    expect(result.success).toBe(true);

    expect(rootFs.mkdir).toHaveBeenCalledWith('/remote/repo/worktrees', { recursive: true });
    expect(rootFs.realPath).toHaveBeenCalledWith('/remote/repo/worktrees');

    await expect(provider.get()).resolves.toMatchObject({
      worktreeDirectory: '/canonical/ssh-worktrees',
    });
  });

  it('rejects ssh relative worktreeDirectory values', async () => {
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
      undefined
    );
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: 'worktrees' });

    expect(result).toEqual({
      success: false,
      error: { type: 'invalid-worktree-directory' },
    });
    expect(rootFs.mkdir).not.toHaveBeenCalled();
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
      undefined
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
      undefined
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
      undefined
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
      ctx
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

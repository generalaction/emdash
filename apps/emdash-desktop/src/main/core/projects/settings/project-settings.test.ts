import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { err, ok } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filesClientScope } from '@main/core/files/runtime-client';
import { DEFAULT_PRESERVE_PATTERNS } from '@shared/core/project-settings/project-settings';
import type { ProjectSettingsStorage } from './project-settings-storage';
import { LocalProjectSettingsProvider } from './providers/local-project-settings-provider';

const storageMockState = vi.hoisted(() => ({
  storage: undefined as ProjectSettingsStorage | undefined,
}));

function makeTrackingGit(isFileCleanlyTracked: boolean) {
  return {
    isFileCleanlyTracked: vi.fn().mockResolvedValue(isFileCleanlyTracked),
  };
}

const projectId = () => `project-${randomUUID()}`;

function makeLocalConfigFiles(projectPath: string) {
  const client = {
    fs: {
      exists: vi.fn(async ({ relative }: { relative: string }) =>
        ok(fs.existsSync(path.join(projectPath, relative)))
      ),
      readText: vi.fn(async ({ relative }: { relative: string }) => {
        try {
          const content = fs.readFileSync(path.join(projectPath, relative), 'utf8');
          return ok({
            content,
            truncated: false,
            totalSize: Buffer.byteLength(content),
            etag: 'test-etag',
          });
        } catch {
          return err({ type: 'not-found' as const, path: relative });
        }
      }),
    },
  };
  return filesClientScope(client as never, projectPath);
}

function makeLocalProvider(
  projectPath: string,
  options?: Omit<
    ConstructorParameters<typeof LocalProjectSettingsProvider>[4],
    'worktreeDirectoryFileSystem'
  >
): LocalProjectSettingsProvider {
  return new LocalProjectSettingsProvider(
    projectId(),
    projectPath,
    'main',
    makeLocalConfigFiles(projectPath),
    {
      ...options,
      worktreeDirectoryFileSystem: {
        mkdir: async (targetPath, mkdirOptions) => {
          try {
            fs.mkdirSync(targetPath, mkdirOptions);
            return ok();
          } catch (error) {
            return err({ message: error instanceof Error ? error.message : String(error) });
          }
        },
        realPath: async (targetPath) => {
          try {
            return ok(fs.realpathSync(targetPath));
          } catch (error) {
            return err({ message: error instanceof Error ? error.message : String(error) });
          }
        },
      },
    }
  );
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

    const provider = makeLocalProvider(projectPath);

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

    const provider = makeLocalProvider(projectPath);

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

    const provider = makeLocalProvider(projectPath);

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

    const git = makeTrackingGit(false);
    const provider = makeLocalProvider(projectPath, { git });

    await expect(provider.get()).resolves.toMatchObject({
      preservePatterns: ['.env.local'],
      shellSetup: 'nvm use',
      scripts: {
        setup: 'pnpm install',
        run: 'pnpm dev',
        teardown: 'pnpm cleanup',
      },
    });
    expect(git.isFileCleanlyTracked).toHaveBeenCalledWith(path.join(projectPath, '.emdash.json'));
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
    const git = makeTrackingGit(false);
    const provider = makeLocalProvider(projectPath, { git });

    await expect(provider.get()).resolves.toMatchObject({
      shellSetup: 'nvm use',
      scripts: {
        setup: 'pnpm install',
        run: 'pnpm dev',
      },
    });
    expect(git.isFileCleanlyTracked).toHaveBeenCalledWith(path.join(projectPath, '.emdash.json'));

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

    const git = makeTrackingGit(true);
    const provider = makeLocalProvider(projectPath, { git });

    await expect(provider.get()).resolves.toMatchObject({
      preservePatterns: [...DEFAULT_PRESERVE_PATTERNS],
    });
    await expect(provider.get()).resolves.not.toHaveProperty('shellSetup');
    await expect(provider.get()).resolves.not.toHaveProperty('scripts');
    expect(git.isFileCleanlyTracked).toHaveBeenCalledWith(path.join(projectPath, '.emdash.json'));
  });

  it('does not seed computed worktreeDirectory into project settings', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = makeLocalProvider(projectPath);

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
    const provider = makeLocalProvider(projectPath);

    await expect(provider.get()).resolves.toMatchObject({ baseRemote: 'upstream' });
    expect(JSON.parse(row.baseProjectSettingsJson)).toEqual({ baseRemote: 'upstream' });
  });

  it('keeps computed worktreeDirectory default separate from configured overrides', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);
    const provider = makeLocalProvider(projectPath);
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
    const provider = makeLocalProvider(projectPath);

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
    const provider = makeLocalProvider(projectPath);

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
    const provider = makeLocalProvider(projectPath);

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
    const provider = makeLocalProvider(projectPath);

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
    const provider = makeLocalProvider(projectPath);

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

    const provider = makeLocalProvider(projectPath);
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

    const provider = makeLocalProvider(projectPath);
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: 'worktrees' });

    expect(result).toEqual({
      success: false,
      error: { type: 'invalid-worktree-directory' },
    });
  });

  it('rejects foreign absolute worktreeDirectory values for local projects', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-settings-local-'));
    tempDirs.push(projectPath);

    const provider = makeLocalProvider(projectPath);
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

    const provider = makeLocalProvider(projectPath);
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

    const provider = makeLocalProvider(projectPath);
    const result = await provider.update({ preservePatterns: [], worktreeDirectory: '   ' });
    expect(result.success).toBe(true);

    await expect(provider.get()).resolves.not.toHaveProperty('worktreeDirectory');
  });
});

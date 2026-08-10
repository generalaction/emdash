import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import { err, ok } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { RepoFacts } from '@core/primitives/project-settings/api';
import { filesClientScope } from '@core/services/runtime-broker/node/files';
import type { ProjectSettingsStorage, StoredProjectSettings } from './project-settings-storage';
import { HostProjectSettingsProvider } from './providers/host-project-settings-provider';

/**
 * Provider-level coverage for the lazy read-path settings migrations
 * (spec: github-git-settings §10) against row fixtures.
 */

const REPO_FACTS: RepoFacts = {
  remotes: [
    { name: 'origin', host: 'github.com', headBranch: 'main', branches: ['main', 'develop'] },
    { name: 'upstream', host: 'github.com', headBranch: 'main', branches: ['main'] },
  ],
  localBranches: ['main', 'feature/x'],
};

function makeConfigFiles(projectPath: string) {
  const client = {
    fs: {
      exists: vi.fn(async ({ path: target }: { path: HostAbsolutePath }) =>
        ok({ exists: fs.existsSync(nativePathFromHost(target)) })
      ),
      readText: vi.fn(async ({ path: target }: { path: HostAbsolutePath }) => {
        try {
          const content = fs.readFileSync(nativePathFromHost(target), 'utf8');
          return ok({
            content,
            truncated: false,
            totalSize: Buffer.byteLength(content),
            etag: 'test-etag',
          });
        } catch {
          return err({ type: 'not-found' as const, path: nativePathFromHost(target) });
        }
      }),
    },
  };
  return filesClientScope(client as never, projectPath);
}

function makeRowStorage(initialBaseJson?: string) {
  const rows = new Map<string, StoredProjectSettings>();
  const seededRow = initialBaseJson
    ? {
        baseProjectSettingsJson: initialBaseJson,
        shareableProjectSettingsJson: '{}',
        legacyConfigMigratedAt: new Date().toISOString(),
      }
    : undefined;
  const storage: ProjectSettingsStorage = {
    get: async (projectId) => rows.get(projectId) ?? seededRowFor(projectId),
    insertIfMissing: async (projectId, settings) => {
      if (!rows.has(projectId) && !seededRow) rows.set(projectId, settings);
    },
    update: async (projectId, settings) => {
      const current = rows.get(projectId) ?? seededRowFor(projectId);
      rows.set(projectId, { ...current!, ...settings });
    },
  };
  function seededRowFor(projectId: string): StoredProjectSettings | undefined {
    if (!seededRow) return undefined;
    if (!rows.has(projectId)) rows.set(projectId, { ...seededRow });
    return rows.get(projectId);
  }
  return {
    storage,
    baseJson: (projectId: string) => JSON.parse(rows.get(projectId)!.baseProjectSettingsJson),
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeProvider(options: {
  baseJson?: string;
  storage?: ProjectSettingsStorage;
  getRepoFacts?: () => Promise<RepoFacts | null>;
  migrateAppWorktreeRoot?: () => Promise<void>;
  defaultBranchFallback?: string;
}) {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-lazy-migrations-'));
  tempDirs.push(projectPath);
  const projectId = `project-${randomUUID()}`;
  const rowStorage = options.storage ? undefined : makeRowStorage(options.baseJson);
  const provider = new HostProjectSettingsProvider(
    projectId,
    projectPath,
    options.defaultBranchFallback ?? 'origin/main',
    makeConfigFiles(projectPath),
    {
      defaultWorktreeDirectory: () => Promise.resolve('/tmp/emdash/worktrees'),
      getProjectDefaults: () => Promise.resolve({ tmuxByDefault: false }),
      storage: options.storage ?? rowStorage!.storage,
      getRepoFacts: options.getRepoFacts,
      migrateAppWorktreeRoot: options.migrateAppWorktreeRoot,
      worktreeDirectoryFileSystem: {
        mkdir: async () => ok(),
        realPath: async (targetPath) => ok(targetPath),
      },
    }
  );
  return { provider, projectId, rowStorage };
}

describe('lazy settings migrations in the provider', () => {
  it('reads a row with all legacy forms back in the new model and rewrites it', async () => {
    const { provider, projectId, rowStorage } = makeProvider({
      baseJson: JSON.stringify({
        defaultBranch: 'origin/main',
        baseRemote: 'origin',
        githubAccountId: 'github.com:42',
        worktreeDirectory: '/tmp/legacy-worktrees',
        tmux: true,
      }),
      getRepoFacts: async () => REPO_FACTS,
    });

    // Legacy in-memory view still works.
    await expect(provider.get()).resolves.toMatchObject({
      githubAccountId: 'github.com:42',
      worktreeDirectory: '/tmp/legacy-worktrees',
      tmux: true,
    });

    // The row is physically rewritten: seeded values cleared (they match the
    // inference), legacy keys renamed and restructured.
    expect(rowStorage!.baseJson(projectId)).toEqual({
      githubAccount: { kind: 'account', accountId: 'github.com:42' },
      worktreeRoot: '/tmp/legacy-worktrees',
      tmux: true,
    });

    // The stored-model surface exposes only explicit choices.
    await expect(provider.getStoredGitSettings()).resolves.toEqual({
      githubAccount: { kind: 'account', accountId: 'github.com:42' },
      worktreeRoot: '/tmp/legacy-worktrees',
    });
  });

  it('demotes values matching inference and keeps divergent values pinned', async () => {
    const { provider, projectId, rowStorage } = makeProvider({
      baseJson: JSON.stringify({
        defaultBranch: 'origin/develop',
        baseRemote: 'origin',
      }),
      getRepoFacts: async () => REPO_FACTS,
    });

    await provider.get();

    // baseRemote 'origin' matches inference and is cleared; the divergent
    // defaultBranch survives as an explicit (structured) setting.
    expect(rowStorage!.baseJson(projectId)).toEqual({
      defaultBranch: { remote: 'origin', branch: 'develop' },
    });
    await expect(provider.getStoredGitSettings()).resolves.toEqual({
      defaultBranch: { remote: 'origin', branch: 'develop' },
    });
  });

  it('keeps stored values pinned when repo facts are unavailable and retries next read', async () => {
    let factsAvailable = false;
    const { provider, projectId, rowStorage } = makeProvider({
      baseJson: JSON.stringify({
        defaultBranch: { remote: 'origin', branch: 'main' },
        baseRemote: 'origin',
      }),
      getRepoFacts: async () => (factsAvailable ? REPO_FACTS : null),
    });

    await provider.get();
    // No destructive migration without facts: both values survive.
    expect(rowStorage!.baseJson(projectId)).toEqual({
      defaultBranch: { remote: 'origin', branch: 'main' },
      baseRemote: 'origin',
    });

    factsAvailable = true;
    await provider.get();
    // The next read demotes both values (they match the inference).
    expect(rowStorage!.baseJson(projectId)).toEqual({});
  });

  it('reads legacy null account rows back as absent (infer)', async () => {
    const { provider, projectId, rowStorage } = makeProvider({
      baseJson: JSON.stringify({ githubAccountId: null, tmux: true }),
    });

    await expect(provider.get()).resolves.not.toHaveProperty('githubAccountId');
    expect(rowStorage!.baseJson(projectId)).toEqual({ tmux: true });
    await expect(provider.getStoredGitSettings()).resolves.toEqual({});
  });

  it('keeps an explicit stored none distinct from absent', async () => {
    const { provider } = makeProvider({
      baseJson: JSON.stringify({ githubAccount: { kind: 'none' } }),
    });

    await expect(provider.get()).resolves.toMatchObject({ githubAccountId: null });
    await expect(provider.getStoredGitSettings()).resolves.toEqual({
      githubAccount: { kind: 'none' },
    });
  });

  it('creates new projects without seeding defaultBranch or baseRemote', async () => {
    const { provider, projectId, rowStorage } = makeProvider({});

    const settings = await provider.get();
    expect(settings).not.toHaveProperty('defaultBranch');
    expect(settings).not.toHaveProperty('baseRemote');
    expect(rowStorage!.baseJson(projectId)).toEqual({ tmux: false });

    // Creation provenance still answers the effective questions.
    await expect(provider.getDefaultBranch()).resolves.toBe('origin/main');
    await expect(provider.getBaseRemote()).resolves.toBe('origin');
  });

  it('derives the base remote fallback from a non-origin creation base ref', async () => {
    const { provider } = makeProvider({ defaultBranchFallback: 'upstream/main' });
    await expect(provider.getBaseRemote()).resolves.toBe('upstream');
    await expect(provider.getPushRemote()).resolves.toBe('upstream');
  });

  it('runs the app worktree-root migration once per provider and retries failures', async () => {
    let calls = 0;
    const migrateAppWorktreeRoot = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('host settings unavailable');
    });
    const { provider } = makeProvider({ migrateAppWorktreeRoot });

    await provider.get(); // fails, swallowed
    await provider.get(); // retried, succeeds
    await provider.get(); // done, not called again

    expect(migrateAppWorktreeRoot).toHaveBeenCalledTimes(2);
  });

  it('persists updates in the stored model', async () => {
    const { provider, projectId, rowStorage } = makeProvider({
      getRepoFacts: async () => REPO_FACTS,
    });

    const result = await provider.update({
      preservePatterns: [],
      defaultBranch: 'origin/develop',
      baseRemote: 'upstream',
      githubAccountId: 'github.com:42',
      worktreeDirectory: '/tmp/updated-worktrees',
    });
    expect(result.success).toBe(true);

    expect(rowStorage!.baseJson(projectId)).toEqual({
      defaultBranch: { remote: 'origin', branch: 'develop' },
      baseRemote: 'upstream',
      githubAccount: { kind: 'account', accountId: 'github.com:42' },
      worktreeRoot: '/tmp/updated-worktrees',
    });
    await expect(provider.get()).resolves.toMatchObject({
      defaultBranch: 'origin/develop',
      baseRemote: 'upstream',
      githubAccountId: 'github.com:42',
      worktreeDirectory: '/tmp/updated-worktrees',
    });
  });
});

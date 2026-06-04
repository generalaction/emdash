import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectGitHubAuthContext } from '@main/core/github/services/project-github-auth-context';
import { ok } from '@shared/result';
import { prSyncEngine } from './pr-sync-engine';
import { PrSyncScheduler } from './pr-sync-scheduler';

const mocks = vi.hoisted(() => {
  const where = vi.fn();
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { select },
    from,
    select,
    where,
    resolveRepository: vi.fn(),
    getProject: vi.fn(),
    projectOn: vi.fn(),
    resolveProjectGitHubAuthContext: vi.fn(),
  };
});

vi.mock('@main/db/client', () => ({
  db: mocks.db,
}));

vi.mock('@main/core/github/services/github-repository-resolver', () => ({
  githubRepositoryResolver: {
    resolve: mocks.resolveRepository,
  },
}));

vi.mock('@main/core/git/git-watcher-registry', () => ({
  gitWatcherRegistry: {
    on: vi.fn(),
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProject,
    on: mocks.projectOn,
  },
}));

vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: {
    hooks: {
      on: vi.fn(),
    },
  },
}));

vi.mock('./pr-sync-engine', () => ({
  prSyncEngine: {
    cancel: vi.fn(),
    sync: vi.fn(),
    syncSingle: vi.fn(),
  },
}));

vi.mock('@main/core/github/services/project-github-auth-context', () => ({
  resolveProjectGitHubAuthContext: mocks.resolveProjectGitHubAuthContext,
}));

vi.mock('./project-remotes-service', () => ({
  syncProjectRemotes: vi.fn(),
}));

type SchedulerInternals = {
  _getGitHubRemoteUrls(projectId: string): Promise<string[]>;
};

describe('PrSyncScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes selected GitHub account context to mounted project syncs', async () => {
    vi.useFakeTimers();
    try {
      const project = {
        settings: {},
        ctx: {},
        repository: {
          getRemotes: vi
            .fn()
            .mockResolvedValue([{ name: 'origin', url: 'https://github.com/acme/repo.git' }]),
        },
      };
      mocks.getProject.mockReturnValue(project);
      mocks.resolveRepository.mockResolvedValue(
        ok({
          host: 'github.com',
          repositoryUrl: 'https://github.com/acme/repo',
          nameWithOwner: 'acme/repo',
          owner: 'acme',
          repo: 'repo',
        })
      );
      mocks.resolveProjectGitHubAuthContext.mockResolvedValue({ accountId: 'github.com:42' });

      const scheduler = new PrSyncScheduler();

      await scheduler.onProjectMounted('project-1');

      expect(resolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
      expect(prSyncEngine.sync).toHaveBeenCalledWith('https://github.com/acme/repo', {
        accountId: 'github.com:42',
      });

      scheduler.onProjectUnmounted('project-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-probe DB-backed fallback remotes', async () => {
    mocks.where.mockResolvedValue([
      { remoteUrl: 'https://ghe.example.com/acme/repo' },
      { remoteUrl: 'not-a-remote' },
    ]);

    const scheduler = new PrSyncScheduler() as unknown as SchedulerInternals;

    await expect(scheduler._getGitHubRemoteUrls('project-1')).resolves.toEqual([
      'https://ghe.example.com/acme/repo',
    ]);
    expect(mocks.resolveRepository).not.toHaveBeenCalled();
  });
});

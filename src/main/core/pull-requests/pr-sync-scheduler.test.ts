import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectGitHubAuthContext } from '@main/core/github/services/project-github-auth-context';
import { err, ok } from '@shared/result';
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

vi.mock('@main/core/projects/settings/project-settings-service', () => ({
  projectSettingsService: {
    on: vi.fn(),
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
      mocks.resolveProjectGitHubAuthContext.mockResolvedValue(ok({ accountId: 'github.com:42' }));

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

  it('does not sync mounted project remotes when account resolution fails', async () => {
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
    mocks.resolveProjectGitHubAuthContext.mockResolvedValue(
      err({
        type: 'account_selection_failed',
        projectId: 'project-1',
        message: 'git config failed',
      })
    );

    const scheduler = new PrSyncScheduler();

    await scheduler.onProjectMounted('project-1');

    expect(resolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
    expect(prSyncEngine.sync).not.toHaveBeenCalled();
  });

  it('passes selected GitHub Enterprise account context to mounted project syncs', async () => {
    const project = {
      settings: {},
      ctx: {},
      repository: {
        getRemotes: vi
          .fn()
          .mockResolvedValue([{ name: 'origin', url: 'https://ghe.example.com/acme/repo.git' }]),
      },
    };
    mocks.getProject.mockReturnValue(project);
    mocks.resolveRepository.mockResolvedValue(
      ok({
        host: 'ghe.example.com',
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        nameWithOwner: 'acme/repo',
        owner: 'acme',
        repo: 'repo',
      })
    );
    mocks.resolveProjectGitHubAuthContext.mockResolvedValue(
      ok({ accountId: 'ghe.example.com:168' })
    );

    const scheduler = new PrSyncScheduler();

    await scheduler.onProjectMounted('project-1');

    expect(resolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
    expect(prSyncEngine.sync).toHaveBeenCalledWith('https://ghe.example.com/acme/repo', {
      accountId: 'ghe.example.com:168',
    });
  });

  it('re-resolves project account context for each scheduled sync tick', async () => {
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
      mocks.resolveProjectGitHubAuthContext
        .mockResolvedValueOnce(ok({ accountId: 'github.com:42' }))
        .mockResolvedValueOnce(ok({ accountId: 'github.com:84' }));

      const scheduler = new PrSyncScheduler();

      await scheduler.onProjectMounted('project-1');
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(prSyncEngine.sync).toHaveBeenNthCalledWith(1, 'https://github.com/acme/repo', {
        accountId: 'github.com:42',
      });
      expect(prSyncEngine.sync).toHaveBeenNthCalledWith(2, 'https://github.com/acme/repo', {
        accountId: 'github.com:84',
      });

      scheduler.onProjectUnmounted('project-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resyncs with fresh account context without rebuilding intervals when project settings change', async () => {
    vi.useFakeTimers();
    let clearIntervalSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      clearIntervalSpy = vi.spyOn(global, 'clearInterval');
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
      mocks.resolveProjectGitHubAuthContext
        .mockResolvedValueOnce(ok({ accountId: 'github.com:42' }))
        .mockResolvedValueOnce(ok({ accountId: 'github.com:84' }))
        .mockResolvedValueOnce(ok({ accountId: 'github.com:126' }));

      const scheduler = new PrSyncScheduler();

      await scheduler.onProjectMounted('project-1');
      clearIntervalSpy.mockClear();

      await scheduler.onProjectSettingsChanged('project-1');
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(prSyncEngine.cancel).toHaveBeenCalledWith('https://github.com/acme/repo');
      expect(clearIntervalSpy).not.toHaveBeenCalled();
      expect(prSyncEngine.sync).toHaveBeenNthCalledWith(1, 'https://github.com/acme/repo', {
        accountId: 'github.com:42',
      });
      expect(prSyncEngine.sync).toHaveBeenNthCalledWith(2, 'https://github.com/acme/repo', {
        accountId: 'github.com:84',
      });
      expect(prSyncEngine.sync).toHaveBeenNthCalledWith(3, 'https://github.com/acme/repo', {
        accountId: 'github.com:126',
      });

      scheduler.onProjectUnmounted('project-1');
    } finally {
      clearIntervalSpy?.mockRestore();
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

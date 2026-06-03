import { describe, expect, it, vi } from 'vitest';
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
    getProject: vi.fn(),
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

vi.mock('./project-remotes-service', () => ({
  syncProjectRemotes: vi.fn(),
}));

type SchedulerInternals = {
  _getGitHubRemoteUrls(projectId: string): Promise<string[]>;
};

describe('PrSyncScheduler', () => {
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

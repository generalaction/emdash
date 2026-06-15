import type { GitRefsModel, GitRemotesModel } from '@emdash/shared/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitRepoUpdateChannel, type GitRepoUpdateEvent } from '@shared/core/git/gitEvents';
import { err, ok } from '@shared/lib/result';
import { GitRepositoryStore } from './git-repository-store';
import type { ProjectSettingsStore } from './project-settings-store';

const mocks = vi.hoisted(() => ({
  getRepoSnapshot: vi.fn(),
  getDefaultBranch: vi.fn(),
  resolveProviderRepository: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    gitRepository: {
      getRepoSnapshot: mocks.getRepoSnapshot,
      getDefaultBranch: mocks.getDefaultBranch,
      resolveProviderRepository: mocks.resolveProviderRepository,
    },
  },
  events: {
    on: mocks.eventOn,
  },
}));

function refs(ahead: number): GitRefsModel {
  return {
    branches: [
      {
        type: 'local',
        branch: 'feature/push-button',
        remote: { name: 'origin', url: 'git@github.com:owner/repo.git' },
        divergence: { ahead, behind: 0 },
        oid: '1111111111111111111111111111111111111111',
      },
      {
        type: 'remote',
        remote: { name: 'origin', url: 'git@github.com:owner/repo.git' },
        branch: 'feature/push-button',
        oid: '2222222222222222222222222222222222222222',
      },
    ],
  };
}

const remotes: GitRemotesModel = {
  remotes: [{ name: 'origin', url: 'git@github.com:owner/repo.git' }],
};

function snapshot(refsModel: GitRefsModel, sequence = 1, generation = 1) {
  return {
    success: true as const,
    data: {
      refs: { value: refsModel, sequence, generation },
      remotes: { value: remotes, sequence, generation },
    },
  };
}

function createWorkspaceStore(): GitRepositoryStore {
  const store = new GitRepositoryStore(
    'project-1',
    { settings: undefined } as unknown as ProjectSettingsStore,
    'main'
  );
  store.start();
  return store;
}

describe('GitRepositoryStore', () => {
  let repoHandlers: Array<(event: GitRepoUpdateEvent) => void>;

  beforeEach(() => {
    repoHandlers = [];
    mocks.getRepoSnapshot.mockReset();
    mocks.getDefaultBranch.mockReset();
    mocks.resolveProviderRepository.mockReset();
    mocks.eventOn.mockReset();
    mocks.eventOn.mockImplementation((channel, handler) => {
      if (channel === gitRepoUpdateChannel) repoHandlers.push(handler);
      return vi.fn();
    });
    mocks.getRepoSnapshot.mockResolvedValue(snapshot(refs(0)));
    mocks.getDefaultBranch.mockResolvedValue(ok({ defaultBranch: 'main' }));
    mocks.resolveProviderRepository.mockResolvedValue(err({ type: 'no_remote' }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates branch divergence from the repo snapshot and applies pushed refs', async () => {
    const store = createWorkspaceStore();

    await vi.waitFor(() => expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(0));

    for (const handler of repoHandlers) {
      handler({
        projectId: 'project-1',
        update: { kind: 'refs', model: refs(2), sequence: 2, generation: 1 },
      });
    }

    expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(2);
    store.dispose();
  });

  it('ignores repo updates for other projects', async () => {
    const store = createWorkspaceStore();

    await vi.waitFor(() => expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(0));

    for (const handler of repoHandlers) {
      handler({
        projectId: 'project-2',
        update: { kind: 'refs', model: refs(2), sequence: 2, generation: 1 },
      });
    }

    expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(0);
    store.dispose();
  });

  it('ignores stale refs by sequence', async () => {
    mocks.getRepoSnapshot.mockResolvedValue(snapshot(refs(3), 3));
    const store = createWorkspaceStore();

    await vi.waitFor(() => expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(3));

    for (const handler of repoHandlers) {
      handler({
        projectId: 'project-1',
        update: { kind: 'refs', model: refs(1), sequence: 2, generation: 1 },
      });
    }

    expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(3);
    store.dispose();
  });

  it('exposes PR and issue repository URLs from provider capabilities', async () => {
    mocks.resolveProviderRepository.mockResolvedValue(
      ok({
        provider: 'github',
        host: 'ghe.example.com',
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: {
          pullRequests: true,
          issues: true,
        },
      })
    );

    const store = createWorkspaceStore();
    await store.providerRepositoryInfo.load();

    expect(store.providerRepository?.host).toBe('ghe.example.com');
    expect(store.pullRequestRepositoryUrl).toBe('https://ghe.example.com/acme/repo');
    expect(store.issueRepositoryUrl).toBe('https://ghe.example.com/acme/repo');

    store.dispose();
  });

  it('clears PR and issue repository URLs when provider resolution fails', async () => {
    mocks.resolveProviderRepository.mockResolvedValue(err({ type: 'no_remote' }));

    const store = createWorkspaceStore();
    await store.providerRepositoryInfo.load();

    expect(store.providerRepository).toBeNull();
    expect(store.pullRequestRepositoryUrl).toBeNull();
    expect(store.issueRepositoryUrl).toBeNull();

    store.dispose();
  });

  it('falls back when default branch resolution returns an expected error', async () => {
    mocks.getDefaultBranch.mockResolvedValue(err({ type: 'not_found' }));

    const store = createWorkspaceStore();
    await store.gitDefaultBranchInfo.load();

    expect(store.gitDefaultBranchInfo.error).toBeUndefined();
    expect(store.remoteData.data.gitDefaultBranch).toBe('main');

    store.dispose();
  });
});

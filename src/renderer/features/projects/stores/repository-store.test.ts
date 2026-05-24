import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitRefChangedChannel, type GitRefChange } from '@shared/events/gitEvents';
import type { LocalBranchesPayload, RemoteBranchesPayload } from '@shared/git';
import { err, ok } from '@shared/result';
import type { ProjectSettingsStore } from './project-settings-store';
import { RepositoryStore } from './repository-store';

const mocks = vi.hoisted(() => ({
  getLocalBranches: vi.fn(),
  getRemoteBranches: vi.fn(),
  resolveProviderRepository: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    repository: {
      getLocalBranches: mocks.getLocalBranches,
      getRemoteBranches: mocks.getRemoteBranches,
      resolveProviderRepository: mocks.resolveProviderRepository,
    },
  },
  events: {
    on: mocks.eventOn,
  },
}));

function localPayload(ahead: number): LocalBranchesPayload {
  return {
    currentBranch: 'feature/push-button',
    isUnborn: false,
    localBranches: [
      {
        type: 'local',
        branch: 'feature/push-button',
        remote: { name: 'origin', url: 'git@github.com:owner/repo.git' },
        divergence: { ahead, behind: 0 },
      },
    ],
  };
}

function remotePayload(): RemoteBranchesPayload {
  return {
    remotes: [{ name: 'origin', url: 'git@github.com:owner/repo.git' }],
    gitDefaultBranch: 'main',
    remoteBranches: [
      {
        type: 'remote',
        remote: { name: 'origin', url: 'git@github.com:owner/repo.git' },
        branch: 'feature/push-button',
      },
    ],
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createWorkspaceStore(): RepositoryStore {
  return new RepositoryStore(
    'project-1',
    { settings: undefined } as unknown as ProjectSettingsStore,
    'main',
    'workspace-1'
  );
}

describe('RepositoryStore', () => {
  let gitRefHandlers: Array<(event: GitRefChange) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    gitRefHandlers = [];
    mocks.getLocalBranches.mockReset();
    mocks.getRemoteBranches.mockReset();
    mocks.resolveProviderRepository.mockReset();
    mocks.eventOn.mockReset();
    mocks.eventOn.mockImplementation((channel, handler) => {
      if (channel === gitRefChangedChannel) gitRefHandlers.push(handler);
      return vi.fn();
    });
    mocks.getRemoteBranches.mockResolvedValue(remotePayload());
    mocks.resolveProviderRepository.mockResolvedValue(err({ type: 'no_remote' }));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function emitGitRefChange(event: GitRefChange): void {
    for (const handler of gitRefHandlers) {
      handler(event);
    }
  }

  it('refreshes task branch divergence when the project branch ref changes', async () => {
    mocks.getLocalBranches
      .mockResolvedValueOnce(localPayload(0))
      .mockResolvedValue(localPayload(1));

    const store = createWorkspaceStore();
    await flushAsyncWork();

    expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(0);

    emitGitRefChange({ projectId: 'project-1', kind: 'local-refs' });
    vi.advanceTimersByTime(250);
    await flushAsyncWork();

    expect(mocks.getLocalBranches).toHaveBeenCalledTimes(2);
    expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(1);

    store.dispose();
  });

  it('refreshes task branch divergence when its workspace branch ref changes', async () => {
    mocks.getLocalBranches
      .mockResolvedValueOnce(localPayload(0))
      .mockResolvedValue(localPayload(2));

    const store = createWorkspaceStore();
    await flushAsyncWork();

    expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(0);

    emitGitRefChange({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      kind: 'local-refs',
    });
    vi.advanceTimersByTime(250);
    await flushAsyncWork();

    expect(mocks.getLocalBranches).toHaveBeenCalledTimes(2);
    expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(2);

    store.dispose();
  });

  it('ignores branch ref changes from other workspaces', async () => {
    mocks.getLocalBranches.mockResolvedValue(localPayload(0));

    const store = createWorkspaceStore();
    await flushAsyncWork();

    emitGitRefChange({
      projectId: 'project-1',
      workspaceId: 'workspace-2',
      kind: 'local-refs',
    });
    vi.advanceTimersByTime(250);
    await flushAsyncWork();

    expect(mocks.getLocalBranches).toHaveBeenCalledTimes(1);
    expect(store.getBranchDivergence('feature/push-button')?.ahead).toBe(0);

    store.dispose();
  });

  it('exposes PR and issue repository URLs from provider capabilities', async () => {
    mocks.getLocalBranches.mockResolvedValue(localPayload(0));
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
    mocks.getLocalBranches.mockResolvedValue(localPayload(0));
    mocks.resolveProviderRepository.mockResolvedValue(err({ type: 'no_remote' }));

    const store = createWorkspaceStore();
    await store.providerRepositoryInfo.load();

    expect(store.providerRepository).toBeNull();
    expect(store.pullRequestRepositoryUrl).toBeNull();
    expect(store.issueRepositoryUrl).toBeNull();

    store.dispose();
  });
});

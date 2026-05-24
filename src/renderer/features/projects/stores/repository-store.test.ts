import { describe, expect, it, vi } from 'vitest';
import { rpc } from '@renderer/lib/ipc';
import { err, ok } from '@shared/result';
import { RepositoryStore } from './repository-store';

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    repository: {
      getLocalBranches: vi.fn().mockResolvedValue({
        isUnborn: false,
        currentBranch: null,
        localBranches: [],
      }),
      getRemoteBranches: vi.fn().mockResolvedValue({
        remoteBranches: [],
        remotes: [],
        gitDefaultBranch: undefined,
      }),
      resolveProviderRepository: vi.fn(),
    },
  },
}));

const mockResolveProviderRepository = vi.mocked(rpc.repository.resolveProviderRepository);

function createStore(): RepositoryStore {
  return new RepositoryStore(
    'project-1',
    {
      settings: undefined,
    } as never,
    'main'
  );
}

describe('RepositoryStore provider repository capabilities', () => {
  it('exposes PR and issue repository URLs from provider capabilities', async () => {
    mockResolveProviderRepository.mockResolvedValue(
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
    const store = createStore();

    await store.providerRepositoryInfo.load();

    expect(store.providerRepository?.host).toBe('ghe.example.com');
    expect(store.pullRequestRepositoryUrl).toBe('https://ghe.example.com/acme/repo');
    expect(store.issueRepositoryUrl).toBe('https://ghe.example.com/acme/repo');
  });

  it('clears PR and issue repository URLs when provider resolution fails', async () => {
    mockResolveProviderRepository.mockResolvedValue(err({ type: 'no_remote' }));
    const store = createStore();

    await store.providerRepositoryInfo.load();

    expect(store.providerRepository).toBeNull();
    expect(store.pullRequestRepositoryUrl).toBeNull();
    expect(store.issueRepositoryUrl).toBeNull();
  });
});

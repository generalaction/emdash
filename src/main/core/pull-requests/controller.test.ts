import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { pullRequestController } from './controller';
import { prSyncEngine } from './pr-sync-engine';
import { resolveProjectGitHubContext } from './project-github-context';

vi.mock('@main/core/repository/provider-repository-service', () => ({
  providerRepositoryService: {
    resolveProject: vi.fn(),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: vi.fn(),
  },
}));

vi.mock('./pr-query-service', () => ({
  prQueryService: {
    listPullRequests: vi.fn(),
    getFilterOptions: vi.fn(),
    getTaskPullRequests: vi.fn(),
  },
}));

vi.mock('./pr-sync-engine', () => ({
  prSyncEngine: {
    createPullRequest: vi.fn(),
    mergePullRequest: vi.fn(),
    markReadyForReview: vi.fn(),
    getPullRequestFiles: vi.fn(),
    getPullRequestComments: vi.fn(),
    syncSingle: vi.fn(),
    syncChecks: vi.fn(),
    forceFullSync: vi.fn(),
    sync: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock('./project-github-context', () => ({
  resolveProjectGitHubContext: vi.fn(),
}));

const mockPrSyncEngine = vi.mocked(prSyncEngine);
const mockResolveProjectGitHubContext = vi.mocked(resolveProjectGitHubContext);

describe('pullRequestController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects cross-host pull request creation before calling GitHub', async () => {
    const result = await pullRequestController.createPullRequest({
      repositoryUrl: 'https://ghe.example.com/acme/repo',
      headRepositoryUrl: 'https://github.com/acme/repo',
      head: 'feature',
      base: 'main',
      title: 'Test',
      draft: false,
    });

    expect(result).toEqual(
      err({ type: 'cross_host_pr', baseHost: 'ghe.example.com', headHost: 'github.com' })
    );
    expect(mockPrSyncEngine.createPullRequest).not.toHaveBeenCalled();
  });

  it('maps github.com auth failures separately from GHES auth failures', async () => {
    mockPrSyncEngine.createPullRequest.mockResolvedValueOnce(
      err({ type: 'auth_required', host: 'github.com', message: 'GitHub auth required' })
    );

    await expect(
      pullRequestController.createPullRequest({
        repositoryUrl: 'https://github.com/acme/repo',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(
      err({
        type: 'github_auth_required',
        host: 'github.com',
        hint: 'Connect GitHub from account settings.',
      })
    );

    mockPrSyncEngine.createPullRequest.mockResolvedValueOnce(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message: 'GHES auth required',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );

    await expect(
      pullRequestController.createPullRequest({
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(
      err({
        type: 'ghes_auth_required',
        host: 'ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });

  it('forwards typed refresh auth failures', async () => {
    mockPrSyncEngine.syncSingle.mockResolvedValue(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message: 'GHES auth required',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );

    await expect(
      pullRequestController.refreshPullRequest('https://ghe.example.com/acme/repo', 12)
    ).resolves.toEqual(
      err({
        type: 'ghes_auth_required',
        host: 'ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });

  it('forwards typed check sync auth failures', async () => {
    mockPrSyncEngine.syncChecks.mockResolvedValue(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message: 'GHES auth required',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );

    await expect(
      pullRequestController.syncChecks('https://ghe.example.com/acme/repo/pull/12', 'abc')
    ).resolves.toEqual(
      err({
        type: 'ghes_auth_required',
        host: 'ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });

  it('forwards PR sync host reachability failures', async () => {
    mockPrSyncEngine.syncSingle.mockResolvedValue(
      err({
        type: 'host_unreachable',
        host: 'github.com',
        reason: 'Connect Timeout Error',
      })
    );

    await expect(
      pullRequestController.refreshPullRequest('https://github.com/acme/repo', 12)
    ).resolves.toEqual(
      err({ type: 'host_unreachable', host: 'github.com', reason: 'Connect Timeout Error' })
    );
  });

  it('passes the project GitHub account context to project-scoped PR sync', async () => {
    mockResolveProjectGitHubContext.mockResolvedValue(
      ok({
        projectId: 'project-1',
        host: 'github.com',
        repositoryUrl: 'https://github.com/acme/repo',
        nameWithOwner: 'acme/repo',
        authContext: { accountId: 'github.com:42' },
      })
    );

    await expect(pullRequestController.syncPullRequests('project-1')).resolves.toEqual(ok());

    expect(mockResolveProjectGitHubContext).toHaveBeenCalledWith('project-1');
    expect(mockPrSyncEngine.sync).toHaveBeenCalledWith('https://github.com/acme/repo', {
      accountId: 'github.com:42',
    });
  });

  it('passes the project GitHub account context to force-full PR sync', async () => {
    mockResolveProjectGitHubContext.mockResolvedValue(
      ok({
        projectId: 'project-1',
        host: 'github.com',
        repositoryUrl: 'https://github.com/acme/repo',
        nameWithOwner: 'acme/repo',
        authContext: { accountId: 'github.com:42' },
      })
    );

    await expect(pullRequestController.forceFullSyncPullRequests('project-1')).resolves.toEqual(
      ok()
    );

    expect(mockResolveProjectGitHubContext).toHaveBeenCalledWith('project-1');
    expect(mockPrSyncEngine.forceFullSync).toHaveBeenCalledWith('https://github.com/acme/repo', {
      accountId: 'github.com:42',
    });
  });

  it('maps create API errors to create_failed', async () => {
    mockPrSyncEngine.createPullRequest.mockResolvedValue(
      err({ type: 'api_error', message: 'Validation failed' })
    );

    await expect(
      pullRequestController.createPullRequest({
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(err({ type: 'create_failed', message: 'Validation failed' }));
  });

  it('maps invalid repository errors', async () => {
    mockPrSyncEngine.createPullRequest.mockResolvedValue(
      err({ type: 'invalid-repository-ref', input: 'not a repository' })
    );

    await expect(
      pullRequestController.createPullRequest({
        repositoryUrl: 'not a repository',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(err({ type: 'invalid_repository', input: 'not a repository' }));
  });

  it('returns created pull request info and triggers a single PR sync', async () => {
    mockPrSyncEngine.createPullRequest.mockResolvedValue(
      ok({ url: 'https://pr.test', number: 12 })
    );
    mockPrSyncEngine.syncSingle.mockResolvedValue(ok(null));

    await expect(
      pullRequestController.createPullRequest({
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(ok({ url: 'https://pr.test', number: 12 }));
    expect(mockPrSyncEngine.syncSingle).toHaveBeenCalledWith(
      'https://ghe.example.com/acme/repo',
      12
    );
  });
});

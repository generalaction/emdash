import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { pullRequestController } from './controller';
import { prSyncEngine } from './pr-sync-engine';
import {
  resolveProjectPullRequestAuthContext,
  resolveProjectPullRequestContext,
} from './project-pull-request-context';

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

vi.mock('./project-pull-request-context', () => ({
  resolveProjectPullRequestAuthContext: vi.fn(),
  resolveProjectPullRequestContext: vi.fn(),
}));

const mockPrSyncEngine = vi.mocked(prSyncEngine);
const mockResolveProjectPullRequestContext = vi.mocked(resolveProjectPullRequestContext);
const mockResolveProjectPullRequestAuthContext = vi.mocked(resolveProjectPullRequestAuthContext);

const selectedAuthContext = { accountId: 'github.com:42' };

function mockProjectGithubContext(
  overrides: Partial<{
    projectId: string;
    repositoryUrl: string;
    host: string;
    nameWithOwner: string;
    authContext: { accountId?: string };
  }> = {}
) {
  mockResolveProjectPullRequestContext.mockResolvedValue(
    ok({
      projectId: overrides.projectId ?? 'project-1',
      host: overrides.host ?? 'github.com',
      repositoryUrl: overrides.repositoryUrl ?? 'https://github.com/acme/repo',
      nameWithOwner: overrides.nameWithOwner ?? 'acme/repo',
      authContext: overrides.authContext ?? selectedAuthContext,
    })
  );
  mockResolveProjectPullRequestAuthContext.mockResolvedValue(
    ok(overrides.authContext ?? selectedAuthContext)
  );
}

describe('pullRequestController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects cross-host pull request creation before calling GitHub', async () => {
    const result = await pullRequestController.createPullRequest('project-1', {
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
    expect(mockResolveProjectPullRequestContext).not.toHaveBeenCalled();
  });

  it('maps github.com auth failures separately from GHES auth failures', async () => {
    mockProjectGithubContext();
    mockPrSyncEngine.createPullRequest.mockResolvedValueOnce(
      err({ type: 'auth_required', host: 'github.com', message: 'GitHub auth required' })
    );

    await expect(
      pullRequestController.createPullRequest('project-1', {
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
      pullRequestController.createPullRequest('project-1', {
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
    mockProjectGithubContext({
      repositoryUrl: 'https://ghe.example.com/acme/repo',
      host: 'ghe.example.com',
    });
    mockPrSyncEngine.syncSingle.mockResolvedValue(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message: 'GHES auth required',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );

    await expect(
      pullRequestController.refreshPullRequest('project-1', 'https://ghe.example.com/acme/repo', 12)
    ).resolves.toEqual(
      err({
        type: 'ghes_auth_required',
        host: 'ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });

  it('forwards typed check sync auth failures', async () => {
    mockProjectGithubContext({
      repositoryUrl: 'https://ghe.example.com/acme/repo',
      host: 'ghe.example.com',
    });
    mockPrSyncEngine.syncChecks.mockResolvedValue(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message: 'GHES auth required',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );

    await expect(
      pullRequestController.syncChecks(
        'project-1',
        'https://ghe.example.com/acme/repo/pull/12',
        'abc'
      )
    ).resolves.toEqual(
      err({
        type: 'ghes_auth_required',
        host: 'ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });

  it('forwards PR sync host reachability failures', async () => {
    mockProjectGithubContext();
    mockPrSyncEngine.syncSingle.mockResolvedValue(
      err({
        type: 'host_unreachable',
        host: 'github.com',
        reason: 'Connect Timeout Error',
      })
    );

    await expect(
      pullRequestController.refreshPullRequest('project-1', 'https://github.com/acme/repo', 12)
    ).resolves.toEqual(
      err({ type: 'host_unreachable', host: 'github.com', reason: 'Connect Timeout Error' })
    );
  });

  it('passes the project GitHub account context to project-scoped PR sync', async () => {
    mockProjectGithubContext();

    await expect(pullRequestController.syncPullRequests('project-1')).resolves.toEqual(ok());

    expect(mockResolveProjectPullRequestContext).toHaveBeenCalledWith('project-1');
    expect(mockPrSyncEngine.sync).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      selectedAuthContext
    );
  });

  it('passes the project GitHub account context to force-full PR sync', async () => {
    mockProjectGithubContext();

    await expect(pullRequestController.forceFullSyncPullRequests('project-1')).resolves.toEqual(
      ok()
    );

    expect(mockResolveProjectPullRequestContext).toHaveBeenCalledWith('project-1');
    expect(mockPrSyncEngine.forceFullSync).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      selectedAuthContext
    );
  });

  it('passes the project GitHub account context to pull request creation and follow-up sync', async () => {
    mockProjectGithubContext();
    mockPrSyncEngine.createPullRequest.mockResolvedValue(
      ok({ url: 'https://github.com/acme/repo/pull/12', number: 12 })
    );
    mockPrSyncEngine.syncSingle.mockResolvedValue(ok(null));

    const params = {
      repositoryUrl: 'https://github.com/acme/repo',
      head: 'feature',
      base: 'main',
      title: 'Test',
      draft: false,
    };

    await expect(pullRequestController.createPullRequest('project-1', params)).resolves.toEqual(
      ok({ url: 'https://github.com/acme/repo/pull/12', number: 12 })
    );

    expect(mockResolveProjectPullRequestContext).not.toHaveBeenCalled();
    expect(mockResolveProjectPullRequestAuthContext).toHaveBeenCalledWith('project-1');
    expect(mockPrSyncEngine.createPullRequest).toHaveBeenCalledWith(params, selectedAuthContext);
    expect(mockPrSyncEngine.syncSingle).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      12,
      selectedAuthContext
    );
  });

  it('does not create pull requests with the default account when project account resolution fails', async () => {
    mockResolveProjectPullRequestAuthContext.mockResolvedValue(
      err({
        type: 'github_account_resolution_failed',
        message: 'Unable to resolve GitHub account for project: git config failed',
      })
    );

    await expect(
      pullRequestController.createPullRequest('project-1', {
        repositoryUrl: 'https://github.com/acme/repo',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(
      err({
        type: 'github_account_resolution_failed',
        message: 'Unable to resolve GitHub account for project: git config failed',
      })
    );

    expect(mockPrSyncEngine.createPullRequest).not.toHaveBeenCalled();
    expect(mockResolveProjectPullRequestContext).not.toHaveBeenCalled();
  });

  it('passes the project GitHub account context to pull request mutations', async () => {
    mockProjectGithubContext();
    mockPrSyncEngine.mergePullRequest.mockResolvedValue(ok({ sha: 'abc123', merged: true }));
    mockPrSyncEngine.markReadyForReview.mockResolvedValue(ok());
    mockPrSyncEngine.syncSingle.mockResolvedValue(ok(null));

    await expect(
      pullRequestController.mergePullRequest('project-1', 'https://github.com/acme/repo', 12, {
        strategy: 'squash',
        commitHeadOid: 'head-sha',
      })
    ).resolves.toEqual(ok({ sha: 'abc123', merged: true }));
    await expect(
      pullRequestController.markReadyForReview('project-1', 'https://github.com/acme/repo', 12)
    ).resolves.toEqual(ok());

    expect(mockPrSyncEngine.mergePullRequest).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      12,
      { strategy: 'squash', commitHeadOid: 'head-sha' },
      selectedAuthContext
    );
    expect(mockPrSyncEngine.markReadyForReview).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      12,
      selectedAuthContext
    );
    expect(mockPrSyncEngine.syncSingle).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      12,
      selectedAuthContext
    );
  });

  it('passes the project GitHub account context to pull request reads', async () => {
    mockProjectGithubContext();
    mockPrSyncEngine.syncSingle.mockResolvedValue(ok(null));
    mockPrSyncEngine.syncChecks.mockResolvedValue(ok(true));
    mockPrSyncEngine.getPullRequestFiles.mockResolvedValue(ok([]));
    mockPrSyncEngine.getPullRequestComments.mockResolvedValue(ok([]));

    await expect(
      pullRequestController.refreshPullRequest('project-1', 'https://github.com/acme/repo', 12)
    ).resolves.toEqual(ok({ pr: null }));
    await expect(
      pullRequestController.syncChecks('project-1', 'https://github.com/acme/repo/pull/12', 'abc')
    ).resolves.toEqual(ok({ hasRunning: true }));
    await expect(
      pullRequestController.getPullRequestFiles('project-1', 'https://github.com/acme/repo', 12)
    ).resolves.toEqual(ok({ files: [] }));
    await expect(
      pullRequestController.getPullRequestComments('project-1', 'https://github.com/acme/repo', 12)
    ).resolves.toEqual(ok({ comments: [] }));

    expect(mockPrSyncEngine.syncSingle).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      12,
      selectedAuthContext
    );
    expect(mockPrSyncEngine.syncChecks).toHaveBeenCalledWith(
      'https://github.com/acme/repo/pull/12',
      'abc',
      selectedAuthContext
    );
    expect(mockPrSyncEngine.getPullRequestFiles).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      12,
      selectedAuthContext
    );
    expect(mockPrSyncEngine.getPullRequestComments).toHaveBeenCalledWith(
      'https://github.com/acme/repo',
      12,
      selectedAuthContext
    );
    expect(mockResolveProjectPullRequestContext).not.toHaveBeenCalled();
    expect(mockResolveProjectPullRequestAuthContext).toHaveBeenCalledTimes(4);
    expect(mockResolveProjectPullRequestAuthContext).toHaveBeenCalledWith('project-1');
  });

  it('maps create API errors to create_failed', async () => {
    mockProjectGithubContext({
      repositoryUrl: 'https://ghe.example.com/acme/repo',
      host: 'ghe.example.com',
    });
    mockPrSyncEngine.createPullRequest.mockResolvedValue(
      err({ type: 'api_error', message: 'Validation failed' })
    );

    await expect(
      pullRequestController.createPullRequest('project-1', {
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(err({ type: 'create_failed', message: 'Validation failed' }));
  });

  it('maps invalid repository errors', async () => {
    mockProjectGithubContext();
    mockPrSyncEngine.createPullRequest.mockResolvedValue(
      err({ type: 'invalid-repository-ref', input: 'not a repository' })
    );

    await expect(
      pullRequestController.createPullRequest('project-1', {
        repositoryUrl: 'not a repository',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(err({ type: 'invalid_repository', input: 'not a repository' }));
  });

  it('returns created pull request info and triggers a single PR sync', async () => {
    mockProjectGithubContext({
      repositoryUrl: 'https://ghe.example.com/acme/repo',
      host: 'ghe.example.com',
    });
    mockPrSyncEngine.createPullRequest.mockResolvedValue(
      ok({ url: 'https://pr.test', number: 12 })
    );
    mockPrSyncEngine.syncSingle.mockResolvedValue(ok(null));

    await expect(
      pullRequestController.createPullRequest('project-1', {
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(ok({ url: 'https://pr.test', number: 12 }));
    expect(mockPrSyncEngine.syncSingle).toHaveBeenCalledWith(
      'https://ghe.example.com/acme/repo',
      12,
      selectedAuthContext
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { githubIssueProvider } from './github-issue-provider';
import { githubRepositoryResolver } from './services/github-repository-resolver';
import { issueService } from './services/issue-service';
import { resolveProjectGitHubAuthContext } from './services/project-github-auth-context';

vi.mock('./services/issue-service', () => ({
  issueService: {
    listIssues: vi.fn(),
    searchIssues: vi.fn(),
  },
}));

vi.mock('./services/github-connection-service', () => ({
  githubConnectionService: {
    getStatus: vi.fn(),
  },
}));

vi.mock('./services/github-repository-resolver', () => ({
  githubRepositoryResolver: {
    resolve: vi.fn(),
  },
}));

vi.mock('./services/project-github-auth-context', () => ({
  resolveProjectGitHubAuthContext: vi.fn(),
}));

const mockIssueService = vi.mocked(issueService);
const mockRepositoryResolver = vi.mocked(githubRepositoryResolver);
const mockResolveProjectGitHubAuthContext = vi.mocked(resolveProjectGitHubAuthContext);

const githubRepository = {
  host: 'github.com',
  owner: 'owner',
  repo: 'repo',
  nameWithOwner: 'owner/repo',
  repositoryUrl: 'https://github.com/owner/repo',
};

const ghesRepository = {
  host: 'ghe.example.com',
  owner: 'owner',
  repo: 'repo',
  nameWithOwner: 'owner/repo',
  repositoryUrl: 'https://ghe.example.com/owner/repo',
};

describe('githubIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepositoryResolver.resolve.mockResolvedValue(ok(githubRepository));
    mockResolveProjectGitHubAuthContext.mockResolvedValue(ok({}));
  });

  it('uses repositoryUrl to resolve the GitHub repository before listing issues', async () => {
    mockIssueService.listIssues.mockResolvedValue(ok([]));

    await githubIssueProvider.listIssues({
      repositoryUrl: 'https://github.com/owner/repo',
      limit: 7,
    });

    expect(mockResolveProjectGitHubAuthContext).not.toHaveBeenCalled();
    expect(mockIssueService.listIssues).toHaveBeenCalledWith(githubRepository, 7, undefined);
  });

  it('passes project GitHub account context when listing issues for a project', async () => {
    mockResolveProjectGitHubAuthContext.mockResolvedValue(ok({ accountId: 'github.com:42' }));
    mockIssueService.listIssues.mockResolvedValue(ok([]));

    await githubIssueProvider.listIssues({
      projectId: 'project-1',
      repositoryUrl: 'https://github.com/owner/repo',
      limit: 7,
    });

    expect(mockResolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
    expect(mockIssueService.listIssues).toHaveBeenCalledWith(githubRepository, 7, {
      accountId: 'github.com:42',
    });
  });

  it('does not list issues with the default account when project account resolution fails', async () => {
    mockResolveProjectGitHubAuthContext.mockResolvedValue(
      err({
        type: 'account_selection_failed',
        projectId: 'project-1',
        message: 'git config failed',
      })
    );
    mockIssueService.listIssues.mockResolvedValue(ok([]));

    await expect(
      githubIssueProvider.listIssues({
        projectId: 'project-1',
        repositoryUrl: 'https://github.com/owner/repo',
        limit: 7,
      })
    ).resolves.toEqual({
      success: false,
      error: 'Unable to resolve GitHub account for project: git config failed',
      errorType: 'generic',
      host: undefined,
    });

    expect(mockIssueService.listIssues).not.toHaveBeenCalled();
  });

  it('falls back to the resolved remote when repositoryUrl is not provided', async () => {
    mockIssueService.searchIssues.mockResolvedValue(ok([]));

    await githubIssueProvider.searchIssues({
      remote: 'git@github.com:owner/repo.git',
      searchTerm: 'bug',
      limit: 3,
    });

    expect(mockResolveProjectGitHubAuthContext).not.toHaveBeenCalled();
    expect(mockIssueService.searchIssues).toHaveBeenCalledWith(
      githubRepository,
      'bug',
      3,
      undefined
    );
  });

  it('passes project GitHub account context when searching issues for a project', async () => {
    mockResolveProjectGitHubAuthContext.mockResolvedValue(ok({ accountId: 'github.com:42' }));
    mockIssueService.searchIssues.mockResolvedValue(ok([]));

    await githubIssueProvider.searchIssues({
      projectId: 'project-1',
      remote: 'git@github.com:owner/repo.git',
      searchTerm: 'bug',
      limit: 3,
    });

    expect(mockResolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
    expect(mockIssueService.searchIssues).toHaveBeenCalledWith(githubRepository, 'bug', 3, {
      accountId: 'github.com:42',
    });
  });

  it('returns unsupported host errors from repository resolution', async () => {
    mockRepositoryResolver.resolve.mockResolvedValue(
      err({ type: 'not_github', host: 'gitlab.example.com', reason: 'not GitHub' })
    );

    await expect(
      githubIssueProvider.listIssues({
        repositoryUrl: 'https://gitlab.example.com/owner/repo',
        limit: 7,
      })
    ).resolves.toEqual({
      success: false,
      error: 'This remote does not appear to be GitHub or GitHub Enterprise.',
      errorType: 'unsupported_host',
      host: 'gitlab.example.com',
    });
  });

  it('returns host reachability errors from repository resolution', async () => {
    mockRepositoryResolver.resolve.mockResolvedValue(
      err({
        type: 'host_unreachable',
        host: 'ghe.example.com',
        reason: 'VPN disconnected',
      })
    );

    await expect(
      githubIssueProvider.searchIssues({
        remote: 'https://ghe.example.com/owner/repo',
        searchTerm: 'bug',
      })
    ).resolves.toEqual({
      success: false,
      error: 'VPN disconnected',
      errorType: 'host_unreachable',
      host: 'ghe.example.com',
    });
  });

  it('returns GHES auth errors from the issue service', async () => {
    mockRepositoryResolver.resolve.mockResolvedValue(ok(ghesRepository));
    mockIssueService.listIssues.mockResolvedValue(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message: 'Run: gh auth login --hostname ghe.example.com',
      })
    );

    await expect(
      githubIssueProvider.listIssues({
        repositoryUrl: 'https://ghe.example.com/owner/repo',
        limit: 7,
      })
    ).resolves.toEqual({
      success: false,
      error: 'Run: gh auth login --hostname ghe.example.com',
      errorType: 'auth_required',
      host: 'ghe.example.com',
    });
  });
});

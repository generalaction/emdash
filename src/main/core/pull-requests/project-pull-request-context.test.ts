import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectGitHubAuthContext } from '@main/core/github/services/project-github-auth-context';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import { err, ok } from '@shared/lib/result';
import {
  resolveProjectPullRequestAuthContext,
  resolveProjectPullRequestContext,
} from './project-pull-request-context';

vi.mock('@main/core/repository/provider-repository-service', () => ({
  providerRepositoryService: {
    resolveProject: vi.fn(),
  },
}));

vi.mock('@main/core/github/services/project-github-auth-context', () => ({
  resolveProjectGitHubAuthContext: vi.fn(),
}));

const mockProviderRepositoryService = vi.mocked(providerRepositoryService);
const mockResolveProjectGitHubAuthContext = vi.mocked(resolveProjectGitHubAuthContext);

describe('project GitHub pull request context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves pull request repository and auth context for a project', async () => {
    mockProviderRepositoryService.resolveProject.mockResolvedValue(
      ok({
        provider: 'github',
        host: 'github.com',
        repositoryUrl: 'https://github.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: { pullRequests: true, issues: true },
      })
    );
    mockResolveProjectGitHubAuthContext.mockResolvedValue(ok({ accountId: 'github.com:42' }));

    await expect(resolveProjectPullRequestContext('project-1')).resolves.toEqual(
      ok({
        projectId: 'project-1',
        repositoryUrl: 'https://github.com/acme/repo',
        host: 'github.com',
        nameWithOwner: 'acme/repo',
        authContext: { accountId: 'github.com:42' },
      })
    );
    expect(mockProviderRepositoryService.resolveProject).toHaveBeenCalledWith('project-1');
    expect(mockResolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
  });

  it('maps project repository errors to pull request remote readiness errors', async () => {
    mockProviderRepositoryService.resolveProject.mockResolvedValue(err({ type: 'no_remote' }));

    await expect(resolveProjectPullRequestContext('project-1')).resolves.toEqual(
      err({ type: 'remote_not_ready', status: 'no_remote' })
    );
    expect(mockResolveProjectGitHubAuthContext).not.toHaveBeenCalled();
  });

  it('maps account resolution errors without falling back to the default account', async () => {
    mockProviderRepositoryService.resolveProject.mockResolvedValue(
      ok({
        provider: 'github',
        host: 'github.com',
        repositoryUrl: 'https://github.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: { pullRequests: true, issues: true },
      })
    );
    mockResolveProjectGitHubAuthContext.mockResolvedValue(
      err({
        type: 'account_selection_failed',
        projectId: 'project-1',
        message: 'git config failed',
      })
    );

    await expect(resolveProjectPullRequestContext('project-1')).resolves.toEqual(
      err({
        type: 'github_account_resolution_failed',
        message: 'Unable to resolve GitHub account for project: git config failed',
      })
    );
  });

  it('maps missing project GitHub account selection without falling back to the default account', async () => {
    mockProviderRepositoryService.resolveProject.mockResolvedValue(
      ok({
        provider: 'github',
        host: 'github.com',
        repositoryUrl: 'https://github.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: { pullRequests: true, issues: true },
      })
    );
    mockResolveProjectGitHubAuthContext.mockResolvedValue(
      err({
        type: 'unconfigured',
        projectId: 'project-1',
        message: 'No GitHub account is configured for this project.',
      })
    );

    await expect(resolveProjectPullRequestContext('project-1')).resolves.toEqual(
      err({
        type: 'github_no_account_selected',
        message: 'No GitHub account is configured for this project.',
      })
    );
  });

  it('maps disabled project GitHub API settings without falling back to the default account', async () => {
    mockProviderRepositoryService.resolveProject.mockResolvedValue(
      ok({
        provider: 'github',
        host: 'github.com',
        repositoryUrl: 'https://github.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: { pullRequests: true, issues: true },
      })
    );
    mockResolveProjectGitHubAuthContext.mockResolvedValue(
      err({
        type: 'disabled',
        projectId: 'project-1',
        message: 'GitHub API is disabled for this project.',
      })
    );

    await expect(resolveProjectPullRequestContext('project-1')).resolves.toEqual(
      err({
        type: 'github_account_disabled',
        message: 'GitHub API is disabled for this project.',
      })
    );
  });

  it('resolves selected account context for GitHub Enterprise project repositories', async () => {
    mockProviderRepositoryService.resolveProject.mockResolvedValue(
      ok({
        provider: 'github',
        host: 'ghe.example.com',
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: { pullRequests: true, issues: true },
      })
    );
    mockResolveProjectGitHubAuthContext.mockResolvedValue(ok({ accountId: 'ghe.example.com:168' }));

    await expect(resolveProjectPullRequestContext('project-1')).resolves.toEqual(
      ok({
        projectId: 'project-1',
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        host: 'ghe.example.com',
        nameWithOwner: 'acme/repo',
        authContext: { accountId: 'ghe.example.com:168' },
      })
    );
    expect(mockResolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
  });

  it('resolves auth-only context without resolving the project repository', async () => {
    mockResolveProjectGitHubAuthContext.mockResolvedValue(ok({ accountId: 'github.com:42' }));

    await expect(resolveProjectPullRequestAuthContext('project-1')).resolves.toEqual(
      ok({ accountId: 'github.com:42' })
    );

    expect(mockProviderRepositoryService.resolveProject).not.toHaveBeenCalled();
    expect(mockResolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
  });

  it('resolves auth-only context for GitHub Enterprise project accounts', async () => {
    mockResolveProjectGitHubAuthContext.mockResolvedValue(ok({ accountId: 'ghe.example.com:168' }));

    await expect(resolveProjectPullRequestAuthContext('project-1')).resolves.toEqual(
      ok({ accountId: 'ghe.example.com:168' })
    );

    expect(mockResolveProjectGitHubAuthContext).toHaveBeenCalledWith('project-1');
  });

  it('maps auth-only account resolution errors', async () => {
    mockResolveProjectGitHubAuthContext.mockResolvedValue(
      err({
        type: 'account_selection_failed',
        projectId: 'project-1',
        message: 'git config failed',
      })
    );

    await expect(resolveProjectPullRequestAuthContext('project-1')).resolves.toEqual(
      err({
        type: 'github_account_resolution_failed',
        message: 'Unable to resolve GitHub account for project: git config failed',
      })
    );
  });

  it('maps auth-only missing project GitHub account selection', async () => {
    mockResolveProjectGitHubAuthContext.mockResolvedValue(
      err({
        type: 'unconfigured',
        projectId: 'project-1',
        message: 'No GitHub account is configured for this project.',
      })
    );

    await expect(resolveProjectPullRequestAuthContext('project-1')).resolves.toEqual(
      err({
        type: 'github_no_account_selected',
        message: 'No GitHub account is configured for this project.',
      })
    );
  });

  it('maps auth-only disabled project GitHub API settings', async () => {
    mockResolveProjectGitHubAuthContext.mockResolvedValue(
      err({
        type: 'disabled',
        projectId: 'project-1',
        message: 'GitHub API is disabled for this project.',
      })
    );

    await expect(resolveProjectPullRequestAuthContext('project-1')).resolves.toEqual(
      err({
        type: 'github_account_disabled',
        message: 'GitHub API is disabled for this project.',
      })
    );
  });
});

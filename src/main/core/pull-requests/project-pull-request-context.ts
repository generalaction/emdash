import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import {
  resolveProjectGitHubAuthContext,
  type ProjectGitHubAuthContextError,
} from '@main/core/github/services/project-github-auth-context';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import type { ProviderRepositoryError } from '@shared/provider-repository';
import type { PullRequestError } from '@shared/pull-requests';
import { err, ok, type Result } from '@shared/result';

export type ProjectPullRequestContext = {
  projectId: string;
  repositoryUrl: string;
  host: string;
  nameWithOwner: string;
  authContext: GitHubApiAuthContext;
};

type ProjectPullRequestContextSourceError = ProviderRepositoryError | ProjectGitHubAuthContextError;

async function resolveProjectPullRequestSourceContext(
  projectId: string
): Promise<Result<ProjectPullRequestContext, ProjectPullRequestContextSourceError>> {
  const repository = await providerRepositoryService.resolveProject(projectId);
  if (!repository.success) return err(repository.error);

  const authContext = await resolveProjectGitHubAuthContext(projectId);
  if (!authContext.success) return err(authContext.error);

  return ok({
    projectId,
    repositoryUrl: repository.data.repositoryUrl,
    host: repository.data.host,
    nameWithOwner: repository.data.nameWithOwner,
    authContext: authContext.data,
  });
}

export async function resolveProjectPullRequestContext(
  projectId: string
): Promise<Result<ProjectPullRequestContext, PullRequestError>> {
  const context = await resolveProjectPullRequestSourceContext(projectId);
  if (context.success) return ok(context.data);
  return err(collapseSourceContextErrorForPullRequests(context.error));
}

export async function resolveProjectPullRequestAuthContext(
  projectId: string
): Promise<Result<GitHubApiAuthContext, PullRequestError>> {
  const authContext = await resolveProjectGitHubAuthContext(projectId);
  if (authContext.success) return ok(authContext.data);
  return err(collapseAuthContextErrorForPullRequests(authContext.error));
}

function collapseSourceContextErrorForPullRequests(
  error: ProjectPullRequestContextSourceError
): PullRequestError {
  switch (error.type) {
    case 'no_account_selected':
      return { type: 'github_no_account_selected', message: error.message };
    case 'project_not_found':
    case 'account_selection_failed':
      return collapseAuthContextErrorForPullRequests(error);
    case 'no_remote':
    case 'invalid_remote':
    case 'unsupported_provider':
    case 'host_unreachable':
    case 'host_error':
      return { type: 'remote_not_ready', status: error.type };
  }
}

function collapseAuthContextErrorForPullRequests(
  error: ProjectGitHubAuthContextError
): PullRequestError {
  if (error.type === 'no_account_selected') {
    return {
      type: 'github_no_account_selected',
      message: error.message,
    };
  }

  return {
    type: 'github_account_resolution_failed',
    message: `Unable to resolve GitHub account for project: ${error.message}`,
  };
}

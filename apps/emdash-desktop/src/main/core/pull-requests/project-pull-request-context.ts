import { err, ok, type Result } from '@emdash/shared';
import { match, P } from 'ts-pattern';
import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import {
  resolveProjectGitHubAuthContext,
  type ProjectGitHubAuthContextError,
} from '@main/core/github/services/project-github-auth-context';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import type { PullRequestError } from '@shared/core/pull-requests/pull-requests';
import type { ProviderRepositoryError } from '@shared/provider-repository';

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
  return match(error)
    .with({ type: 'unconfigured' }, (e) => ({
      type: 'github_no_account_selected' as const,
      message: e.message,
    }))
    .with({ type: 'disabled' }, (e) => ({
      type: 'github_account_disabled' as const,
      message: e.message,
    }))
    .with(P.union({ type: 'project_not_found' }, { type: 'account_selection_failed' }), (e) =>
      collapseAuthContextErrorForPullRequests(e)
    )
    .with(
      P.union(
        { type: 'no_remote' },
        { type: 'invalid_remote' },
        { type: 'unsupported_provider' },
        { type: 'host_unreachable' },
        { type: 'host_error' }
      ),
      (e) => ({ type: 'remote_not_ready' as const, status: e.type })
    )
    .exhaustive();
}

function collapseAuthContextErrorForPullRequests(
  error: ProjectGitHubAuthContextError
): PullRequestError {
  if (error.type === 'unconfigured') {
    return {
      type: 'github_no_account_selected',
      message: error.message,
    };
  }
  if (error.type === 'disabled') {
    return {
      type: 'github_account_disabled',
      message: error.message,
    };
  }

  return {
    type: 'github_account_resolution_failed',
    message: `Unable to resolve GitHub account for project: ${error.message}`,
  };
}

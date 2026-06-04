import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import {
  resolveProjectGitHubAuthContext,
  type ProjectGitHubAuthContextError,
} from '@main/core/github/services/project-github-auth-context';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import type { ProviderRepositoryError } from '@shared/provider-repository';
import { err, ok, type Result } from '@shared/result';

export type ProjectGitHubContext = {
  projectId: string;
  repositoryUrl: string;
  host: string;
  nameWithOwner: string;
  authContext: GitHubApiAuthContext;
};

export type ProjectGitHubContextError = ProviderRepositoryError | ProjectGitHubAuthContextError;

export async function resolveProjectGitHubContext(
  projectId: string
): Promise<Result<ProjectGitHubContext, ProjectGitHubContextError>> {
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

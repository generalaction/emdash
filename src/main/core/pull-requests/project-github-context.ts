import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import type { ProviderRepositoryError } from '@shared/provider-repository';
import { err, ok, type Result } from '@shared/result';
import { resolveProjectGitHubAuthContext } from './project-github-auth-context';

export type ProjectGitHubContext = {
  projectId: string;
  repositoryUrl: string;
  host: string;
  nameWithOwner: string;
  authContext: GitHubApiAuthContext;
};

export async function resolveProjectGitHubContext(
  projectId: string
): Promise<Result<ProjectGitHubContext, ProviderRepositoryError>> {
  const repository = await providerRepositoryService.resolveProject(projectId);
  if (!repository.success) return err(repository.error);

  const authContext = await resolveProjectGitHubAuthContext(projectId);
  return ok({
    projectId,
    repositoryUrl: repository.data.repositoryUrl,
    host: repository.data.host,
    nameWithOwner: repository.data.nameWithOwner,
    authContext,
  });
}

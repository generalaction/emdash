import { githubAccountSelectionResolver } from '@main/core/github/services/github-account-selection-resolver';
import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import { projectManager } from '@main/core/projects/project-manager';
import { log } from '@main/lib/logger';

export async function resolveProjectGitHubAuthContext(
  projectId: string
): Promise<GitHubApiAuthContext> {
  const project = projectManager.getProject(projectId);
  if (!project) return {};

  try {
    const selection = await githubAccountSelectionResolver.resolve(project);
    return { accountId: selection.accountId };
  } catch (error) {
    log.warn('Failed to resolve project GitHub account selection', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

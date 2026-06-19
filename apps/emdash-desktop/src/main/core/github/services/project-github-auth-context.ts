import type { Result } from '@emdash/shared';
import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import { projectManager } from '@main/core/projects/project-manager';
import { log } from '@main/lib/logger';
import {
  ProjectGitHubAuthContextResolver,
  type ProjectGitHubAuthContextError,
} from './project-github-auth-context-resolver';

export type { ProjectGitHubAuthContextError } from './project-github-auth-context-resolver';

const projectGitHubAuthContextResolver = new ProjectGitHubAuthContextResolver({
  projects: projectManager,
  logger: log,
});

export function resolveProjectGitHubAuthContext(
  projectId: string
): Promise<Result<GitHubApiAuthContext, ProjectGitHubAuthContextError>> {
  return projectGitHubAuthContextResolver.resolve(projectId);
}

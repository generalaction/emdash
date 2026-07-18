import { err, ok, type Result } from '@emdash/shared';
import { toIntegrationError } from '../../helpers/error';
import { resolveInstanceRemote } from '../../helpers/repository-remote';
import type { IntegrationError } from '../../types';
import type { GitLabClient, GitLabCredentials } from './types';

export type GitLabProject = {
  projectId: number;
  projectName: string | null;
};

export async function resolveGitLabProject(
  client: GitLabClient,
  credentials: GitLabCredentials,
  repositoryUrl: string | undefined
): Promise<Result<GitLabProject, IntegrationError>> {
  const remote = resolveInstanceRemote(repositoryUrl, credentials.instanceUrl, 'GitLab');
  if (!remote.success) return err(remote.error);

  try {
    const project = await client.Projects.show(remote.data.slug);

    return ok({
      projectId: project.id,
      projectName: project.name,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'GitLab', 'Unable to resolve the GitLab project.'));
  }
}

import { err, ok, type Result } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import { parseGitRemoteUrl } from '../../../integrations/helpers/git-remote';
import {
  assertRemoteHostMatchesInstance,
  RemoteHostMismatchError,
} from '../../../integrations/helpers/hosted-instance';
import type { GitLabClient, GitLabCredentials } from '../../../integrations/impl/gitlab/types';
import type { IntegrationError } from '../../../integrations/types';

export type GitLabProject = {
  projectId: number;
  projectName: string | null;
};

export async function resolveGitLabProject(
  client: GitLabClient,
  credentials: GitLabCredentials,
  repositoryUrl: string | undefined
): Promise<Result<GitLabProject, IntegrationError>> {
  const remoteUrl = repositoryUrl?.trim();
  if (!remoteUrl) {
    return err({
      type: 'invalid_input',
      message: 'Repository URL is required.',
    });
  }

  const remote = parseGitRemoteUrl(remoteUrl);
  if (!remote) {
    return err({
      type: 'invalid_input',
      message: 'Unable to parse repository URL.',
    });
  }

  try {
    assertRemoteHostMatchesInstance(remote.host, credentials.instanceUrl, 'GitLab');
  } catch (error) {
    if (error instanceof RemoteHostMismatchError) {
      return err({
        type: 'unsupported_host',
        message: error.message,
      });
    }

    return err({
      type: 'invalid_input',
      message: 'A valid GitLab instance URL is required.',
    });
  }

  try {
    const project = await client.Projects.show(remote.slug);

    return ok({
      projectId: project.id,
      projectName: project.name,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'GitLab'));
  }
}

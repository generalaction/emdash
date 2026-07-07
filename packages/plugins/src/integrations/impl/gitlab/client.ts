import { err, ok, type Result } from '@emdash/shared';
import { Gitlab } from '@gitbeaker/rest';
import { parseCredentials } from '../../helpers/credentials';
import { toIntegrationError } from '../../helpers/error';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import {
  type GitLabClient,
  type GitLabCredentials,
  gitLabCredentialsSchema,
  type GitLabVerifiedConnection,
} from './types';

export function readGitLabCredentials(
  credentials: IntegrationCredentials
): Result<GitLabCredentials, IntegrationError> {
  return parseCredentials(gitLabCredentialsSchema, credentials);
}

export function createGitLabClient(credentials: GitLabCredentials): GitLabClient {
  return new Gitlab({
    host: credentials.instanceUrl,
    token: credentials.apiToken,
  });
}

export async function verifyGitLabCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<GitLabVerifiedConnection, IntegrationError>> {
  const credentials = readGitLabCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  const client = createGitLabClient(credentials.data);
  try {
    const user = await client.Users.showCurrentUser();
    const username = user.username;
    const displayName = user.name;

    const host = new URL(credentials.data.instanceUrl).host;
    const displayDetail =
      username && displayName && username !== displayName ? `@${username} · ${host}` : host;

    return ok({
      displayName,
      displayDetail,
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'GitLab'));
  }
}

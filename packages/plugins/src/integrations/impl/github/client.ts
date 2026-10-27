import { err, ok, type Result } from '@emdash/shared';
import { Octokit } from '@octokit/rest';
import { parseCredentials } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import { toGitHubIntegrationError } from './error';
import {
  type GitHubClient,
  type GitHubCredentials,
  gitHubCredentialsSchema,
  type GitHubVerifiedConnection,
} from './types';

const VERIFY_TIMEOUT_MS = 10_000;

export function readGitHubCredentials(
  credentials: IntegrationCredentials
): Result<GitHubCredentials, IntegrationError> {
  return parseCredentials(gitHubCredentialsSchema, credentials);
}

export function createGitHubClient(credentials: GitHubCredentials): GitHubClient {
  return new Octokit({ auth: credentials.accessToken, baseUrl: credentials.apiBaseUrl });
}

export async function verifyGitHubCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<GitHubVerifiedConnection, IntegrationError>> {
  const credentials = readGitHubCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  const octokit = createGitHubClient(credentials.data);
  try {
    const { data } = await octokit.rest.users.getAuthenticated({
      request: { timeout: VERIFY_TIMEOUT_MS },
    });

    const host = new URL(credentials.data.apiBaseUrl).host;

    return ok({
      account: {
        id: String(data.id),
        login: data.login,
        ...(data.avatar_url ? { avatarUrl: data.avatar_url } : {}),
        host: host === 'api.github.com' ? 'github.com' : host,
      },
      displayName: data.name ?? data.login,
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toGitHubIntegrationError(error, 'Failed to verify GitHub credentials.'));
  }
}

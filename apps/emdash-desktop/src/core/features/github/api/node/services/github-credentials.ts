import {
  gitHubCredentialsSchema,
  type GitHubCredentials,
} from '@emdash/plugins/integrations/github';
import { err, ok, type Result } from '@emdash/shared';
import type { IntegrationAccountReader } from '@core/features/integrations/api/node/integration-accounts';
import { normalizeRepositoryHost } from '@core/primitives/repository/api';
import type { ProviderAccountStore } from '@core/services/provider-accounts/api/provider-account-store';
import {
  githubApiAccountHostMismatch,
  githubApiAccountNotFound,
  githubApiTokenMissing,
  type GitHubApiAuthError,
} from '../../../node/services/github-api-auth-errors';

export type ReadGitHubCredentials = (
  accountId: string,
  expectedHost: string
) => Promise<Result<GitHubCredentials, GitHubApiAuthError>>;

/** Read one already-selected account; selection and defaults belong to the caller. */
export function createGitHubCredentialReader(
  credentials: IntegrationAccountReader,
  accountLookup: Pick<ProviderAccountStore, 'getAccount'>
): ReadGitHubCredentials {
  return async (accountId, expectedHost) => {
    const host = normalizeRepositoryHost(expectedHost);
    const selectedId = accountId.trim();
    if (!selectedId) return err(githubApiAccountNotFound(host, selectedId));

    const stored = await credentials.getAccount('github', selectedId);
    if (!stored) {
      const exists = await accountLookup.getAccount('github', selectedId);
      return err(
        exists
          ? githubApiTokenMissing(host, selectedId)
          : githubApiAccountNotFound(host, selectedId)
      );
    }

    const accountHost = stored.identity?.host;
    if (accountHost && normalizeRepositoryHost(accountHost) !== host) {
      return err(githubApiAccountHostMismatch(host, selectedId, accountHost));
    }
    const parsed = gitHubCredentialsSchema.safeParse(stored.credentials);
    if (!parsed.success) return err(githubApiTokenMissing(host, selectedId));
    const apiHost = new URL(parsed.data.apiBaseUrl).host;
    const credentialHost =
      apiHost === 'api.github.com' ? 'github.com' : normalizeRepositoryHost(apiHost);
    if (credentialHost !== host) {
      return err(githubApiAccountHostMismatch(host, selectedId, credentialHost));
    }
    return ok(parsed.data);
  };
}

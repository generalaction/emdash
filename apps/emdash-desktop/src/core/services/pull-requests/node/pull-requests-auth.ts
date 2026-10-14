import { parseRepositoryRef } from '@emdash/core/primitives/repository/api';
import type { PullRequestAuthError } from '@emdash/plugins/pull-requests/schemas';
import { err, ok, type Result } from '@emdash/shared';
import { createController, type Controller } from '@emdash/wire/rpc';
import { gitPlatformAuthContract } from '@core/services/pull-requests/api';
import type { PullRequestSyncIdentityResolver } from './sync-identity';

type ReadGitHubCredentials = (
  accountId: string,
  expectedHost: string
) => Promise<Result<{ accessToken: string; apiBaseUrl: string }, PullRequestAuthError>>;

/**
 * Desktop-side answer to the worker's per-sync identity request (spec:
 * github-git-settings §8): resolve *as whom* through the blessed resolver for
 * the repository, then fetch that account's token. Identity failures pass
 * through fail-closed — the worker skips the sync instead of running as a
 * different account.
 */
export function createPullRequestsGitHubAuthController(
  readCredentials: ReadGitHubCredentials,
  resolveSyncIdentity: PullRequestSyncIdentityResolver
): Controller {
  return createController(gitPlatformAuthContract, {
    resolveAuth: async (input) => {
      const repository = parseRepositoryRef(input.repositoryUrl);
      if (!repository) {
        return err({
          type: 'account_unresolvable',
          host: 'unknown',
          message: `Unrecognized repository URL: ${input.repositoryUrl}`,
        });
      }
      const identity = await resolveSyncIdentity(input.repositoryUrl);
      if (!identity.success) return identity;
      const credentials = await readCredentials(identity.data.accountId, repository.host);
      if (!credentials.success) return credentials;
      return ok({
        integrationId: 'github',
        accountId: identity.data.accountId,
        credentials: {
          accessToken: credentials.data.accessToken,
          apiBaseUrl: credentials.data.apiBaseUrl,
        },
      });
    },
  });
}

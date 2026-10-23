import { parseRepositoryRef } from '@emdash/core/primitives/repository/api';
import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import type { PullRequestAuthError } from '@emdash/plugins/pull-requests/schemas';
import { err, ok, type Result } from '@emdash/shared';
import { createController, type Controller } from '@emdash/wire/rpc';
import { gitPlatformAuthContract } from '@core/services/pull-requests/api';
import type {
  PullRequestIntegrationResolver,
  PullRequestSyncIdentityResolver,
} from './sync-identity';

type ReadIntegrationCredentials = (
  integrationId: string,
  accountId: string,
  expectedHost: string
) => Promise<Result<IntegrationCredentials, PullRequestAuthError>>;

/**
 * Desktop-side answers to the worker (spec: github-git-settings §8): which
 * integration serves a repository, and *as whom* to sync it. Identity failures
 * pass through fail-closed — the worker skips the sync instead of running as
 * a different account.
 */
export function createPullRequestsAuthController(dependencies: {
  resolveIntegration: PullRequestIntegrationResolver;
  resolveSyncIdentity: PullRequestSyncIdentityResolver;
  readCredentials: ReadIntegrationCredentials;
}): Controller {
  return createController(gitPlatformAuthContract, {
    resolveIntegration: async ({ repositoryUrl }) =>
      await dependencies.resolveIntegration(repositoryUrl),
    resolveAuth: async ({ repositoryUrl, integrationId: routedIntegrationId }) => {
      const repository = parseRepositoryRef(repositoryUrl);
      if (!repository) {
        return err({
          type: 'account_unresolvable',
          host: 'unknown',
          message: `Unrecognized repository URL: ${repositoryUrl}`,
        });
      }
      const identity = await dependencies.resolveSyncIdentity(repositoryUrl, routedIntegrationId);
      if (!identity.success) return identity;
      const { integrationId, accountId } = identity.data;
      const credentials = await dependencies.readCredentials(
        integrationId,
        accountId,
        repository.host
      );
      if (!credentials.success) return credentials;
      return ok({ integrationId, accountId, credentials: credentials.data });
    },
  });
}

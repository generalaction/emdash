import { parseRepositoryRef } from '@agent/core/primitives/repository/api';
import type { PullRequestAuthError } from '@agent/plugins/pull-requests/schemas';
import { err, type Result } from '@agent/shared';

export type PullRequestSyncIdentity = { integrationId: string; accountId: string };

export type PullRequestSyncIdentityResolver = (
  repositoryUrl: string,
  integrationId: string
) => Promise<Result<PullRequestSyncIdentity, PullRequestAuthError>>;

export type PullRequestIntegrationResolution = Result<
  { integrationId: string },
  { type: 'unsupported_provider' | 'host_unreachable'; host: string; reason: string }
>;

export type PullRequestIntegrationResolver = (
  repositoryUrl: string
) => Promise<PullRequestIntegrationResolution>;

let boundResolver: PullRequestSyncIdentityResolver | undefined;

/**
 * Late-binding seam between the pull-request worker's auth controller (wired
 * at worker spawn, before services boot) and the identity resolution that
 * lives with the desktop registration. Until a resolver is bound, identity
 * requests fail closed — the sync is skipped and retried later, never run as
 * an implicit default account.
 */
export function bindPullRequestSyncIdentityResolver(
  resolver: PullRequestSyncIdentityResolver
): void {
  boundResolver = resolver;
}

export async function resolvePullRequestSyncIdentity(
  repositoryUrl: string,
  integrationId: string
): Promise<Result<PullRequestSyncIdentity, PullRequestAuthError>> {
  if (!boundResolver) {
    return err({
      type: 'account_unresolvable',
      host: parseRepositoryRef(repositoryUrl)?.host ?? 'unknown',
      message: 'GitHub identity resolution is not available yet; the desktop is still starting.',
    });
  }
  return await boundResolver(repositoryUrl, integrationId);
}

let boundIntegrationResolver: PullRequestIntegrationResolver | undefined;

export function bindPullRequestIntegrationResolver(resolver: PullRequestIntegrationResolver): void {
  boundIntegrationResolver = resolver;
}

export async function resolvePullRequestIntegration(
  repositoryUrl: string
): Promise<PullRequestIntegrationResolution> {
  if (!boundIntegrationResolver) {
    return err({
      type: 'unsupported_provider',
      host: parseRepositoryRef(repositoryUrl)?.host ?? 'unknown',
      reason: 'Repository routing is not available yet; the desktop is still starting.',
    });
  }
  return await boundIntegrationResolver(repositoryUrl);
}

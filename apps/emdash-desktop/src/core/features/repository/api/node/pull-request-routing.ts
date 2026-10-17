import {
  normalizeRepositoryHost,
  parseRepositoryRef,
} from '@emdash/core/primitives/repository/api';
import { err, ok, type Result } from '@emdash/shared';
import type { ProjectIntegrationAccountResolver } from '@core/features/integrations/api/node/project-integration-account-resolver';
import { providerRepositoryErrorMessage } from '@core/primitives/repository/api';
import type { RepositoryRouter } from './repository-router';

type Route = Pick<RepositoryRouter, 'route'>['route'];

export type PullRequestIntegrationResult = Result<
  { integrationId: string },
  { type: 'unsupported_provider' | 'host_unreachable'; host: string; reason: string }
>;

export type PullRequestAccountResult = Result<
  { accountId: string },
  {
    type: 'unconfigured' | 'disabled' | 'account_selection_failed';
    message: string;
  }
>;

/** Repository URLs among `remoteUrls` that route to an integration with pull-request support. */
export async function pullRequestRepositoryUrls(
  route: Route,
  remoteUrls: string[],
  hasPullRequests: (integrationId: string) => boolean
): Promise<string[]> {
  const routed = await Promise.all(remoteUrls.map(async (url) => await route(url)));
  return [
    ...new Set(
      routed.flatMap((result) =>
        result.success && hasPullRequests(result.data.integrationId)
          ? [result.data.repository.repositoryUrl]
          : []
      )
    ),
  ];
}

/** The PR worker's `resolveIntegration` answer; an unreachable host is not reported as unsupported. */
export async function resolvePullRequestIntegration(
  route: Route,
  repositoryUrl: string
): Promise<PullRequestIntegrationResult> {
  const result = await route(repositoryUrl);
  if (result.success) return ok({ integrationId: result.data.integrationId });
  const host = normalizeRepositoryHost(parseRepositoryRef(repositoryUrl)?.host ?? 'unknown');
  const error = result.error;
  if (error.type === 'host_unreachable' || error.type === 'host_error') {
    return err({ type: 'host_unreachable', host, reason: error.reason });
  }
  return err({ type: 'unsupported_provider', host, reason: providerRepositoryErrorMessage(error) });
}

/**
 * The project's effective account for `integrationId`, keyed to the project's
 * base remote (spec: github-git-settings §7/§8). Failures carry the
 * registration's structural error types so per-sync identity fails closed.
 */
export async function resolvePullRequestAccount(
  resolveAccount: ProjectIntegrationAccountResolver,
  projectId: string,
  integrationId: string,
  integrationName: string
): Promise<PullRequestAccountResult> {
  const account = await resolveAccount(projectId, integrationId, { kind: 'project' });
  if (account.value !== null) return ok({ accountId: account.value.accountId });
  switch (account.provenance.kind) {
    case 'set':
      return err({ type: 'disabled', message: `${integrationName} is disabled for this project.` });
    case 'unresolvable':
    case 'broken-setting':
      return err({
        type: 'account_selection_failed',
        message: `The selected ${integrationName} account is no longer connected.`,
      });
    default:
      return err({
        type: 'unconfigured',
        message: `No ${integrationName} account is configured for this project.`,
      });
  }
}

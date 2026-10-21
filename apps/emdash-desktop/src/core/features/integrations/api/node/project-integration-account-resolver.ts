import type { StoredIntegrationAccounts } from '@core/primitives/project-settings/api/project-settings';
import type { ProviderAccountResolutionSnapshot } from '@core/primitives/project-settings/api/resolve-provider-account';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import {
  resolveProjectAccount,
  type ProjectAccountRepository,
  type ProjectAccountRepositoryFacts,
} from '../project-account-resolution';

export type ProjectIntegrationAccountResolution =
  ProviderAccountResolutionSnapshot<ProviderAccountSummary>;

/** One project account resolver for issues, PRs, Git credentials, and other provider operations. */
export type ProjectIntegrationAccountResolver = (
  projectId: string,
  providerId: string,
  repository?: ProjectAccountRepository
) => Promise<ProjectIntegrationAccountResolution>;

export function createProjectIntegrationAccountResolver(deps: {
  getStoredIntegrationAccounts(projectId: string): Promise<StoredIntegrationAccounts>;
  getProjectRepositoryContext(projectId: string): Promise<ProjectAccountRepositoryFacts>;
  listAccounts(providerId: string): Promise<ProviderAccountSummary[]>;
}): ProjectIntegrationAccountResolver {
  return async (projectId, providerId, repository) => {
    const [stored, accounts, repositoryContext] = await Promise.all([
      deps.getStoredIntegrationAccounts(projectId),
      deps.listAccounts(providerId),
      repository?.kind === 'project'
        ? deps
            .getProjectRepositoryContext(projectId)
            .then((facts) => ({ kind: 'project' as const, ...facts }))
        : repository,
    ]);
    return resolveProjectAccount({
      providerId,
      stored,
      accounts,
      repository: repositoryContext,
    });
  };
}

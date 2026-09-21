import { getProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import type { ProviderAccountResolutionSnapshot } from '@core/primitives/project-settings/api/resolve-provider-account';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import {
  resolveProjectAccount,
  type ProjectAccountRepository,
} from '../project-account-resolution';
import { useAccounts } from './use-provider-accounts';

type ProjectAccountOptions = { repository?: ProjectAccountRepository };

export function useProjectAccount<Account extends ProviderAccountSummary>(
  projectId: string,
  providerId: string,
  options: ProjectAccountOptions & {
    accepts: (account: ProviderAccountSummary) => account is Account;
  }
): ProviderAccountResolutionSnapshot<Account> | null;
export function useProjectAccount(
  projectId: string,
  providerId: string,
  options?: ProjectAccountOptions
): ProviderAccountResolutionSnapshot<ProviderAccountSummary> | null;
/** Call inside an observer component. Account selection does not depend on placement settings. */
export function useProjectAccount(
  projectId: string,
  providerId: string,
  options: ProjectAccountOptions & { accepts?: (account: ProviderAccountSummary) => boolean } = {}
): ProviderAccountResolutionSnapshot<ProviderAccountSummary> | null {
  const { data: inventory } = useAccounts(providerId);
  const domains = getProjectSettingsStore(projectId)?.durableDomains;
  const repo =
    options.repository?.kind === 'project' ? getGitRepositoryStore(projectId) : undefined;
  if (!domains || !inventory || repo?.loading) return null;
  return resolveProjectAccount({
    providerId,
    stored: domains.integrationAccounts.stored,
    accounts: options.accepts ? inventory.filter(options.accepts) : inventory,
    repository:
      options.repository?.kind === 'project'
        ? {
            kind: 'project',
            storedGitSettings: domains.gitIdentity.stored,
            repoFacts: repo?.repoFacts ?? null,
          }
        : options.repository,
  });
}

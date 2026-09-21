import {
  resolveEffectiveGitSettings,
  type RepoFacts,
  type StoredProjectGitSettings,
} from '@core/primitives/project-settings/api/effective-settings';
import type { StoredIntegrationAccounts } from '@core/primitives/project-settings/api/project-settings';
import {
  providerAccountContextKey,
  providerAccountHostMatching,
  resolveProviderAccount,
  type ProviderAccountResolutionSnapshot,
} from '@core/primitives/project-settings/api/resolve-provider-account';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { parseRepositoryRef } from '@core/primitives/repository/api';

/** Account selection explicitly names the operation's repository context. */
export type ProjectAccountRepository = { kind: 'project' } | { kind: 'url'; url: string };

export type ProjectAccountRepositoryFacts = {
  storedGitSettings: StoredProjectGitSettings;
  repoFacts: RepoFacts | null;
};

/** Pure account policy shared by browser previews and node operations. */
export function resolveProjectAccount<Account extends ProviderAccountSummary>(options: {
  providerId: string;
  stored: StoredIntegrationAccounts;
  accounts: Account[];
  repository?: { kind: 'url'; url: string } | ({ kind: 'project' } & ProjectAccountRepositoryFacts);
}): ProviderAccountResolutionSnapshot<Account> {
  const { accounts, repository } = options;
  const choice = options.stored[options.providerId];
  let host: string | null = null;
  if (repository?.kind === 'url') {
    host = parseRepositoryRef(repository.url)?.host ?? null;
  } else if (repository?.kind === 'project') {
    const facts = repository.repoFacts ?? { remotes: [], localBranches: [] };
    const baseRemote = resolveEffectiveGitSettings(repository.storedGitSettings, facts).baseRemote
      .value;
    host = facts.remotes.find((remote) => remote.name === baseRemote)?.host ?? null;
  }
  return {
    ...resolveProviderAccount(
      choice,
      accounts,
      repository ? providerAccountHostMatching(host) : undefined
    ),
    accounts,
    contextKey: providerAccountContextKey(choice, accounts),
  };
}

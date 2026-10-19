import { normalizeRepositoryHost } from '@emdash/core/primitives/repository/api';
import { repositoryPluginRegistry } from '@emdash/plugins/repository';
import { log } from '@emdash/shared/logger';
import type { ReadIntegrationCredentials } from '@core/features/integrations/api/node/integration-credential-reader';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';

export function createGitLabRepositoryService(deps: {
  listAccounts(): Promise<ProviderAccountSummary[]>;
  readCredentials: ReadIntegrationCredentials;
}) {
  const behavior = repositoryPluginRegistry.get('gitlab')?.behavior.repository;
  if (!behavior) throw new Error('GitLab repository plugin is not registered.');
  const logger = log.child({ integration: 'gitlab' });

  async function host(accountId: string) {
    const account = (await deps.listAccounts()).find(
      (item) => item.providerId === 'gitlab' && item.accountId === accountId
    );
    if (!account || !account.host) throw new Error('The selected GitLab account is unavailable.');
    const credentials = await deps.readCredentials('gitlab', accountId, account.host);
    if (!credentials.success) throw new Error(credentials.error.message);
    const instanceUrl = credentials.data.instanceUrl;
    if (
      typeof instanceUrl !== 'string' ||
      normalizeRepositoryHost(new URL(instanceUrl).host) !== normalizeRepositoryHost(account.host)
    ) {
      throw new Error('The selected GitLab account does not match its instance URL.');
    }
    return { credentials: credentials.data, log: logger };
  }

  return {
    async getOwners(accountId: string) {
      return behavior.listOwners(await host(accountId));
    },
    async createRepository(input: {
      accountId: string;
      owner: string;
      name: string;
      isPrivate: boolean;
      initializeWithReadme?: boolean;
    }) {
      return behavior.createRepository(await host(input.accountId), {
        owner: input.owner,
        name: input.name,
        visibility: input.isPrivate ? 'private' : 'public',
        initializeWithReadme: input.initializeWithReadme,
      });
    },
    async deleteRepository(input: { accountId: string; owner: string; name: string }) {
      return behavior.deleteRepository(await host(input.accountId), {
        owner: input.owner,
        name: input.name,
      });
    },
  };
}

export type GitLabRepositoryService = ReturnType<typeof createGitLabRepositoryService>;

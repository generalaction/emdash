import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import type { IssuesPluginProvider } from '@emdash/plugins/issues';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
} from '@core/features/issues/api/node/issue-provider';
import {
  createIssueListOperations,
  toIssueProviderCapabilities,
  toLinkedIssue,
} from '@core/features/issues/api/node/plugin-issue-adapter';
import { classifyProjectAccountResolution } from '@core/features/issues/api/node/project-account-context';
import type {
  IssueContextResult,
  IssueListError,
  IssueProviderType,
} from '@core/primitives/issue-providers/api';
import { linkedIssueResourcesMatch } from '@core/primitives/linked-issues/api/linked-issue';
import {
  providerAccountContextKey,
  resolveProviderAccount,
} from '@core/primitives/project-settings/api';
import { providerAccountHostMatching } from '@core/primitives/project-settings/api/resolve-provider-account';
import { parseRepositoryRef } from '@core/primitives/repository/api';
import { getProviderAccountService } from '@core/services/provider-accounts/node/provider-account-service';
import { getIntegrationAccountStore } from '../../node/integration-account-store-instance';
import { getIntegrationConnectionService } from '../../node/integration-connection-service';
import type { ProjectIntegrationAccountResolver } from './project-integration-account-resolver';

export type PluginIssueProviderDependencies = {
  resolveProjectIntegrationAccount: ProjectIntegrationAccountResolver;
};

export function createPluginIssueProvider(
  plugin: IssuesPluginProvider,
  dependencies: PluginIssueProviderDependencies
): IssueProvider {
  const provider = plugin.metadata.integrationId as IssueProviderType;
  const capabilities = toIssueProviderCapabilities(plugin);
  const pluginLog = log.child({ integration: provider });

  type ConnectedAccount = {
    credentials: IntegrationCredentials;
    accountId: string;
  };

  /**
   * The credentials this call runs with. Without a project context, the
   * provider's default account. With one, the project's account resolution
   * applies (mirrors the GitHub §7 reporting matrix): an explicit pin
   * resolves to that account, explicit none and dangling pins fail closed
   * with an `account_unavailable` payload carrying the provenance.
   */
  async function getConnectedAccount(
    opts: IssueQueryOpts,
    sourceAccountId?: string
  ): Promise<Result<ConnectedAccount, IssueListError>> {
    const url = repositoryUrl(opts);
    if (capabilities.requiresRepositoryUrl && !url) {
      return err({
        type: 'invalid_input',
        message: 'Repository URL including its host is required.',
      });
    }
    if (!opts.projectId) {
      if (sourceAccountId) return hostForAccount(sourceAccountId);
      const accounts = await getProviderAccountService().listAccounts(provider);
      if (
        opts.accountContext !== undefined &&
        opts.accountContext !== providerAccountContextKey(undefined, accounts)
      ) {
        return err({
          type: 'account_context_changed',
          message: 'Integration account selection changed. Refreshing accounts.',
        });
      }
      const account = resolveProviderAccount(
        undefined,
        accounts,
        capabilities.requiresRepositoryUrl
          ? providerAccountHostMatching(parseRepositoryRef(url ?? '')?.host ?? null)
          : undefined
      ).value;
      return account ? hostForAccount(account.accountId) : notConnectedError();
    }

    const resolution = await dependencies.resolveProjectIntegrationAccount(
      opts.projectId,
      provider,
      capabilities.requiresRepositoryUrl && url ? { kind: 'url', url } : undefined
    );
    if (opts.accountContext !== undefined && opts.accountContext !== resolution.contextKey) {
      return err({
        type: 'account_context_changed',
        message: 'Integration account selection changed. Refreshing accounts.',
      });
    }
    const accountsConnected = resolution.value !== null || resolution.accounts.length > 0;
    const context = classifyProjectAccountResolution(resolution, {
      accountsConnected,
      disabledMessage: `${provider} is disabled for this project.`,
      unresolvableMessage: `The ${provider} account set for this project is no longer connected.`,
    });
    if (context.kind === 'unavailable' && resolution.provenance.kind === 'set') {
      return err(context.error);
    }
    // A linked resource keeps its original identity even after a project's
    // preferred account changes. Project suppression still takes precedence.
    if (sourceAccountId) return hostForAccount(sourceAccountId);
    if (context.kind === 'unavailable') return err(context.error);
    if (context.kind === 'account') return hostForAccount(context.account.accountId);
    // Inferred absent: no accounts are connected at all.
    return err({
      type: 'account_unavailable',
      provenance: resolution.provenance,
      accountsConnected,
      message: `Connect a ${provider} account to get started.`,
    });
  }

  async function hostForAccount(
    accountId: string
  ): Promise<Result<ConnectedAccount, IssueListError>> {
    const account = await getIntegrationAccountStore().getAccount(provider, accountId);
    if (!account) return notConnectedError();
    return ok({ credentials: account.credentials, accountId: account.accountId });
  }

  function repositoryUrl(opts: IssueQueryOpts): string | undefined {
    const value = (opts.repositoryUrl || opts.remote)?.trim();
    if (value && capabilities.requiresRepositoryUrl) {
      return parseRepositoryRef(value)?.repositoryUrl;
    }
    return value || undefined;
  }

  function notConnectedError(): Result<never, IssueListError> {
    return err({ type: 'auth_required', message: `${provider} is not connected.` });
  }

  return {
    type: provider,
    capabilities,

    checkConnection: () =>
      getIntegrationConnectionService().checkConnection(provider, capabilities),

    ...createIssueListOperations(plugin, async (opts) => {
      const account = await getConnectedAccount(opts);
      return account.success
        ? ok({
            host: { log: pluginLog, credentials: account.data.credentials },
            accountId: account.data.accountId,
            repositoryUrl: repositoryUrl(opts),
          })
        : account;
    }),

    getIssueContext: plugin.behavior.issues?.getIssue
      ? async (opts: IssueContextOpts): Promise<IssueContextResult> => {
          const term = String(opts.identifier || '').trim();
          if (!term) {
            return err({ type: 'invalid_input', message: 'Issue identifier is required.' });
          }

          const account = await getConnectedAccount(opts, opts.accountId);
          if (!account.success) return account;

          const result = await plugin.behavior.issues?.getIssue?.(
            { log: pluginLog, credentials: account.data.credentials },
            {
              identifier: term,
              repositoryUrl: repositoryUrl(opts),
            }
          );
          if (!result) {
            return err({
              type: 'generic',
              message: `${provider} does not support issue context.`,
            });
          }
          if (!result.success) return err(result.error);
          if (
            opts.issueUrl &&
            !linkedIssueResourcesMatch(provider, opts.issueUrl, result.data.url ?? '')
          ) {
            return err({
              type: 'not_found_or_no_access',
              message:
                'The linked issue belongs to a different account or workspace. Select the issue again to update its source.',
            });
          }
          return ok(toLinkedIssue(provider, result.data, account.data.accountId));
        }
      : undefined,
  };
}

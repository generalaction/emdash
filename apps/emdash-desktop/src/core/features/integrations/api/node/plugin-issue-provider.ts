import type { IssuesPluginProvider } from '@emdash/plugins/issues';
import { err, type Err, ok } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@core/features/issues/api/node/issue-provider';
import {
  clampIssueProviderLimit,
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  toIssueProviderCapabilities,
  toLinkedIssue,
} from '@core/features/issues/api/node/plugin-issue-adapter';
import type {
  IssueContextResult,
  IssueListError,
  IssueListResult,
  IssueProviderType,
} from '@core/primitives/issue-providers/api';
import { getIntegrationConnectionService } from '../../node/integration-connection-service';
import { getIntegrationCredentialStore } from '../../node/integration-credential-store-instance';

export function createPluginIssueProvider(plugin: IssuesPluginProvider): IssueProvider {
  const provider = plugin.metadata.integrationId as IssueProviderType;
  const capabilities = toIssueProviderCapabilities(plugin);
  const pluginLog = log.child({ integration: provider });

  async function getConnectedHost() {
    const credentials = await getIntegrationCredentialStore().get(provider);
    if (!credentials) {
      return null;
    }
    return { log: pluginLog, credentials };
  }

  function repositoryUrl(opts: IssueQueryOpts): string | undefined {
    const value = opts.repositoryUrl?.trim();
    return value || undefined;
  }

  function notConnectedError(): Err<IssueListError> {
    return err({ type: 'auth_required', message: `${provider} is not connected.` });
  }

  function missingRepositoryError(): Err<IssueListError> {
    return err({ type: 'invalid_input', message: 'Repository URL is required.' });
  }

  return {
    type: provider,
    capabilities,

    isConfigured: () => getIntegrationCredentialStore().isConfigured(provider),

    checkConnection: () =>
      getIntegrationConnectionService().checkConnection(provider, capabilities),

    async listIssues(opts: IssueQueryOpts): Promise<IssueListResult> {
      const host = await getConnectedHost();
      if (!host) return notConnectedError();

      if (capabilities.requiresRepositoryUrl && !repositoryUrl(opts)) {
        return missingRepositoryError();
      }

      const result = await plugin.behavior.issues?.listIssues(host, {
        limit: clampIssueProviderLimit(opts.limit, DEFAULT_LIST_LIMIT),
        repositoryUrl: repositoryUrl(opts),
      });
      if (!result) return ok([]);
      if (!result.success) return err(result.error);
      return ok(result.data.map((issue) => toLinkedIssue(provider, issue)));
    },

    async searchIssues(opts: IssueSearchOpts): Promise<IssueListResult> {
      const term = String(opts.searchTerm || '').trim();
      if (!term) return ok([]);

      const host = await getConnectedHost();
      if (!host) return notConnectedError();

      if (capabilities.requiresRepositoryUrl && !repositoryUrl(opts)) {
        return missingRepositoryError();
      }

      const result = await plugin.behavior.issues?.searchIssues(host, {
        limit: clampIssueProviderLimit(opts.limit, DEFAULT_SEARCH_LIMIT),
        searchTerm: term,
        repositoryUrl: repositoryUrl(opts),
      });
      if (!result) return ok([]);
      if (!result.success) return err(result.error);
      return ok(result.data.map((issue) => toLinkedIssue(provider, issue)));
    },

    getIssueContext: plugin.behavior.issues?.getIssue
      ? async (opts: IssueContextOpts): Promise<IssueContextResult> => {
          const term = String(opts.identifier || '').trim();
          if (!term) {
            return err({ type: 'invalid_input', message: 'Issue identifier is required.' });
          }

          const host = await getConnectedHost();
          if (!host) return notConnectedError();

          const result = await plugin.behavior.issues?.getIssue?.(host, {
            identifier: term,
            repositoryUrl: repositoryUrl(opts),
          });
          if (!result) {
            return err({
              type: 'generic',
              message: `${provider} does not support issue context.`,
            });
          }
          if (!result.success) return err(result.error);
          return ok(toLinkedIssue(provider, result.data));
        }
      : undefined,
  };
}

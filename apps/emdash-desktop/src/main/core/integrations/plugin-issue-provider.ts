import type { IssuesPluginProvider } from '@emdash/plugins/issues';
import { log } from '@main/lib/logger';
import type {
  IssueContextResult,
  IssueListResult,
  IssueProviderType,
} from '@shared/issue-providers';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../issues/issue-provider';
import {
  clampIssueProviderLimit,
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  mapPluginIssueError,
  mapPluginIssueErrorType,
  toIssueProviderCapabilities,
  toLinkedIssue,
} from '../issues/plugin-issue-adapter';
import { integrationConnectionService } from './integration-connection-service';
import { integrationCredentialStore } from './integration-credential-store-instance';

function missingRepositoryResult(): IssueListResult {
  return { success: false, error: 'Repository URL is required.', errorType: 'generic' };
}

export function createPluginIssueProvider(plugin: IssuesPluginProvider): IssueProvider {
  const provider = plugin.metadata.integrationId as IssueProviderType;
  const capabilities = toIssueProviderCapabilities(plugin);
  const pluginLog = log.child({ integration: provider });

  async function getConnectedHost() {
    const credentials = await integrationCredentialStore.get(provider);
    if (!credentials) {
      return null;
    }
    return { log: pluginLog, credentials };
  }

  function repositoryUrl(opts: IssueQueryOpts): string | undefined {
    const value = opts.repositoryUrl?.trim();
    return value || undefined;
  }

  return {
    type: provider,
    capabilities,

    isConfigured: () => integrationCredentialStore.isConfigured(provider),

    checkConnection: () => integrationConnectionService.checkConnection(provider, capabilities),

    async listIssues(opts: IssueQueryOpts): Promise<IssueListResult> {
      const host = await getConnectedHost();
      if (!host) {
        return {
          success: false,
          error: `${provider} is not connected.`,
          errorType: 'auth_required',
        };
      }

      if (capabilities.requiresRepositoryUrl && !repositoryUrl(opts)) {
        return missingRepositoryResult();
      }

      const result = await plugin.behavior.issues?.listIssues(host, {
        limit: clampIssueProviderLimit(opts.limit, DEFAULT_LIST_LIMIT),
        repositoryUrl: repositoryUrl(opts),
      });
      if (!result) return { success: true, issues: [] };
      if (!result.success) return mapPluginIssueError(result.error);
      return { success: true, issues: result.data.map((issue) => toLinkedIssue(provider, issue)) };
    },

    async searchIssues(opts: IssueSearchOpts): Promise<IssueListResult> {
      const term = String(opts.searchTerm || '').trim();
      if (!term) return { success: true, issues: [] };

      const host = await getConnectedHost();
      if (!host) {
        return {
          success: false,
          error: `${provider} is not connected.`,
          errorType: 'auth_required',
        };
      }

      if (capabilities.requiresRepositoryUrl && !repositoryUrl(opts)) {
        return missingRepositoryResult();
      }

      const result = await plugin.behavior.issues?.searchIssues(host, {
        limit: clampIssueProviderLimit(opts.limit, DEFAULT_SEARCH_LIMIT),
        searchTerm: term,
        repositoryUrl: repositoryUrl(opts),
      });
      if (!result) return { success: true, issues: [] };
      if (!result.success) return mapPluginIssueError(result.error);
      return { success: true, issues: result.data.map((issue) => toLinkedIssue(provider, issue)) };
    },

    getIssueContext: plugin.behavior.issues?.getIssue
      ? async (opts: IssueContextOpts): Promise<IssueContextResult> => {
          const term = String(opts.identifier || '').trim();
          if (!term) return { success: false, error: 'Issue identifier is required.' };

          const host = await getConnectedHost();
          if (!host) {
            return {
              success: false,
              error: `${provider} is not connected.`,
              errorType: 'auth_required',
            };
          }

          const result = await plugin.behavior.issues?.getIssue?.(host, {
            identifier: term,
            repositoryUrl: repositoryUrl(opts),
          });
          if (!result)
            return { success: false, error: `${provider} does not support issue context.` };
          if (!result.success) {
            return {
              success: false,
              error: result.error.message,
              errorType: mapPluginIssueErrorType(result.error),
            };
          }
          return { success: true, issue: toLinkedIssue(provider, result.data) };
        }
      : undefined,
  };
}

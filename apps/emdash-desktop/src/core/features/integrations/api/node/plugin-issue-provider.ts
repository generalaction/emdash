import type { IntegrationCredentials } from '@emdash/plugins/integrations';
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
import type { ProjectIntegrationAccountResolver } from './services/project-integration-account-resolver';

export type PluginIssueProviderDeps = {
  resolveProjectAccount?: ProjectIntegrationAccountResolver;
};

export function createPluginIssueProvider(
  plugin: IssuesPluginProvider,
  deps: PluginIssueProviderDeps = {}
): IssueProvider {
  const provider = plugin.metadata.integrationId as IssueProviderType;
  const capabilities = toIssueProviderCapabilities(plugin);
  const pluginLog = log.child({ integration: provider });

  type ConnectedHost = {
    log: typeof pluginLog;
    credentials: IntegrationCredentials;
    accountId: string;
  };
  type HostResolution = { host: ConnectedHost } | { error: Err<IssueListError> };

  /**
   * Resolve the account for the request's project (fail closed on a dangling
   * pin — never another workspace's credential) and load its credentials.
   */
  async function resolveConnectedHost(opts: { projectId?: string }): Promise<HostResolution> {
    let accountId: string | undefined;
    if (opts.projectId && deps.resolveProjectAccount) {
      const resolution = await deps.resolveProjectAccount({
        projectId: opts.projectId,
        integrationId: provider,
      });
      if (resolution.value) {
        accountId = resolution.value.accountId;
      } else if (resolution.provenance.kind === 'unresolvable') {
        return {
          error: err({
            type: 'auth_required',
            message: `The ${provider} workspace pinned to this project is no longer connected. Reconnect it or pick another workspace in project settings.`,
          }),
        };
      } else if (resolution.provenance.kind === 'set') {
        return {
          error: err({
            type: 'auth_required',
            message: `${provider} is disabled for this project. Pick a workspace in project settings to enable it.`,
          }),
        };
      }
      // `inferred` with no value falls through to the default account below.
    }

    const record = await getIntegrationCredentialStore().getAccount(provider, accountId);
    if (!record) return { error: notConnectedError() };
    return {
      host: { log: pluginLog, credentials: record.credentials, accountId: record.accountId },
    };
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
      const resolved = await resolveConnectedHost(opts);
      if ('error' in resolved) return resolved.error;
      const host = resolved.host;

      if (capabilities.requiresRepositoryUrl && !repositoryUrl(opts)) {
        return missingRepositoryError();
      }

      const result = await plugin.behavior.issues?.listIssues(host, {
        limit: clampIssueProviderLimit(opts.limit, DEFAULT_LIST_LIMIT),
        repositoryUrl: repositoryUrl(opts),
      });
      if (!result) return ok([]);
      if (!result.success) return err(result.error);
      return ok(result.data.map((issue) => toLinkedIssue(provider, issue, host.accountId)));
    },

    async searchIssues(opts: IssueSearchOpts): Promise<IssueListResult> {
      const term = String(opts.searchTerm || '').trim();
      if (!term) return ok([]);

      const resolved = await resolveConnectedHost(opts);
      if ('error' in resolved) return resolved.error;
      const host = resolved.host;

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
      return ok(result.data.map((issue) => toLinkedIssue(provider, issue, host.accountId)));
    },

    getIssueContext: plugin.behavior.issues?.getIssue
      ? async (opts: IssueContextOpts): Promise<IssueContextResult> => {
          const term = String(opts.identifier || '').trim();
          if (!term) {
            return err({ type: 'invalid_input', message: 'Issue identifier is required.' });
          }

          const resolved = await resolveConnectedHost(opts);
          if ('error' in resolved) return resolved.error;
          const host = resolved.host;

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
          return ok(toLinkedIssue(provider, result.data, host.accountId));
        }
      : undefined,
  };
}

import type { IssuesPluginProvider, IssueData, IssueError } from '@emdash/plugins/issues';
import { log } from '@main/lib/logger';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type {
  IssueContextResult,
  IssueListError,
  IssueListResult,
  IssueProviderCapabilities,
  IssueProviderType,
} from '@shared/issue-providers';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../issues/issue-provider';
import { integrationConnectionService } from './integration-connection-service';
import { integrationCredentialStore } from './integration-credential-store';

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_ISSUE_LIMIT = 500;

function clampLimit(limit: number | undefined, fallback: number): number {
  const resolved = Number.isFinite(limit) ? (limit as number) : fallback;
  return Math.max(1, Math.min(resolved, MAX_ISSUE_LIMIT));
}

function toCapabilities(plugin: IssuesPluginProvider): IssueProviderCapabilities {
  const requiredInputs = plugin.capabilities.issues.requiredInputs;
  return {
    requiresRepositoryUrl: requiredInputs.includes('repositoryUrl'),
    supportsIssueContext: !!plugin.behavior.issues?.getIssue,
  };
}

function toLinkedIssue(provider: IssueProviderType, issue: IssueData): LinkedIssue {
  const detail = issue as IssueData & { context?: string };
  return {
    provider,
    identifier: issue.identifier,
    displayIdentifier: issue.displayIdentifier,
    title: issue.title,
    url: issue.url ?? '',
    description: issue.description,
    context: detail.context,
    branchName: issue.branchName,
    status: issue.status,
    assignees: issue.assignees,
    project: issue.project,
    updatedAt: issue.updatedAt,
    fetchedAt: new Date().toISOString(),
  };
}

function missingRepositoryResult(): IssueListResult {
  return { success: false, error: 'Repository URL is required.', errorType: 'generic' };
}

function issueErrorMetadata(
  error: IssueError
): Partial<Extract<IssueListResult, { success: false }>> {
  if (error.type === 'rate_limited') return { resetAt: error.resetAt };
  if (error.type === 'sso_required') return { ssoUrl: error.ssoUrl };
  return {};
}

export function mapPluginIssueError(
  error: IssueError
): Extract<IssueListResult, { success: false }> {
  const errorType: IssueListError['type'] =
    error.type === 'auth_failed'
      ? 'auth_required'
      : error.type === 'invalid_input'
        ? 'generic'
        : error.type;

  return {
    success: false,
    error: error.message,
    errorType,
    ...issueErrorMetadata(error),
  };
}

export function createPluginIssueProvider(plugin: IssuesPluginProvider): IssueProvider {
  const provider = plugin.metadata.integrationId as IssueProviderType;
  const capabilities = toCapabilities(plugin);

  async function getConnectedHost() {
    const credentials = await integrationCredentialStore.get(provider);
    if (!credentials) {
      return null;
    }
    return { log, credentials };
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
        limit: clampLimit(opts.limit, DEFAULT_LIST_LIMIT),
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
        limit: clampLimit(opts.limit, DEFAULT_SEARCH_LIMIT),
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
          if (!host) return { success: false, error: `${provider} is not connected.` };

          const result = await plugin.behavior.issues?.getIssue?.(host, {
            identifier: term,
            repositoryUrl: repositoryUrl(opts),
          });
          if (!result)
            return { success: false, error: `${provider} does not support issue context.` };
          if (!result.success) return { success: false, error: result.error.message };
          return { success: true, issue: toLinkedIssue(provider, result.data) };
        }
      : undefined,
  };
}

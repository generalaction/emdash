import type { ConnectedIntegrationHostContext } from '@emdash/plugins/integrations';
import type { IssueDetail, IssuesPluginProvider } from '@emdash/plugins/issues';
import { err, ok, type Result } from '@emdash/shared';
import type {
  IssueProviderCapabilities,
  IssueProviderType,
  IssueListError,
  IssueListResult,
  IssueQueryOpts,
} from '@core/primitives/issue-providers/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type { IssueProvider } from './issue-provider';

/** Desktop-owned access and result attribution; only host is passed into the plugin. */
type ResolvedIssueAccess = {
  host: ConnectedIntegrationHostContext;
  accountId: string;
  repositoryUrl?: string;
};

/** Provider adapters prepare access; list/search execution has one policy and result mapping. */
export function createIssueListOperations(
  plugin: IssuesPluginProvider,
  prepare: (opts: IssueQueryOpts) => Promise<Result<ResolvedIssueAccess, IssueListError>>
): Pick<IssueProvider, 'listIssues' | 'searchIssues'> {
  const provider = plugin.metadata.integrationId as IssueProviderType;
  const capabilities = toIssueProviderCapabilities(plugin);
  async function invoke(opts: IssueQueryOpts, searchTerm?: string): Promise<IssueListResult> {
    const context = await prepare(opts);
    if (!context.success) return context;
    const { repositoryUrl, host } = context.data;
    if (capabilities.requiresRepositoryUrl && !repositoryUrl) {
      return err({ type: 'invalid_input', message: 'Repository URL is required.' });
    }
    const result =
      searchTerm === undefined
        ? await plugin.behavior.issues?.listIssues(host, {
            limit: clampIssueProviderLimit(opts.limit, DEFAULT_LIST_LIMIT),
            repositoryUrl,
          })
        : await plugin.behavior.issues?.searchIssues(host, {
            limit: clampIssueProviderLimit(opts.limit, DEFAULT_SEARCH_LIMIT),
            repositoryUrl,
            searchTerm,
          });
    if (!result) return ok([]);
    if (!result.success) return err(result.error);
    return ok(result.data.map((issue) => toLinkedIssue(provider, issue, context.data.accountId)));
  }
  return {
    listIssues: (opts) => invoke(opts),
    searchIssues: (opts) => {
      const term = String(opts.searchTerm || '').trim();
      return term ? invoke(opts, term) : Promise.resolve(ok([]));
    },
  };
}

export const DEFAULT_LIST_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 20;
const MAX_ISSUE_LIMIT = 500;

export function clampIssueProviderLimit(limit: number | undefined, fallback: number): number {
  const resolved = Number.isFinite(limit) ? (limit as number) : fallback;
  return Math.max(1, Math.min(resolved, MAX_ISSUE_LIMIT));
}

export function toIssueProviderCapabilities(
  plugin: IssuesPluginProvider
): IssueProviderCapabilities {
  const requiredInputs = plugin.capabilities.issues.requiredInputs;
  return {
    requiresRepositoryUrl: requiredInputs.includes('repositoryUrl'),
    supportsIssueContext: !!plugin.behavior.issues?.getIssue,
  };
}

export function toLinkedIssue(
  provider: IssueProviderType,
  issue: IssueDetail,
  accountId?: string
): LinkedIssue {
  return {
    provider,
    ...(accountId ? { accountId } : {}),
    identifier: issue.identifier,
    displayIdentifier: issue.displayIdentifier,
    title: issue.title,
    url: issue.url ?? '',
    description: issue.description,
    context: issue.context,
    branchName: issue.branchName,
    status: issue.status,
    assignees: issue.assignees,
    project: issue.project,
    updatedAt: issue.updatedAt,
    fetchedAt: new Date().toISOString(),
  };
}

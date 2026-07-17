import type { IssuesPluginProvider, IssueDetail } from '@emdash/plugins/issues';
import type {
  IssueProviderCapabilities,
  IssueProviderType,
} from '@core/primitives/issue-providers/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

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

export function toLinkedIssue(provider: IssueProviderType, issue: IssueDetail): LinkedIssue {
  return {
    provider,
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

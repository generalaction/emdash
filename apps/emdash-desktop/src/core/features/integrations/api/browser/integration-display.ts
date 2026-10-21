import type { IssueProviderType } from '@core/primitives/issue-providers/api';
import type { IntegrationProviderDescriptor } from '../contract';

export const ISSUE_FEATURE_LABELS: Record<string, string> = {
  issues: 'Issues',
  pullRequests: 'Pull Requests',
  repositories: 'Repositories',
};

const DEFAULT_ISSUE_TERMS = {
  singular: 'issue',
  plural: 'issues',
  title: 'Issue',
  article: 'an',
} as const;
const GITLAB_WORK_ITEM_TERMS = {
  singular: 'work item',
  plural: 'work items',
  title: 'Work Item',
  article: 'a',
} as const;

/** Provider-facing names for entities handled by the shared issues plugin. */
export function issueTerms(provider: string | null | undefined) {
  return provider === 'gitlab' ? GITLAB_WORK_ITEM_TERMS : DEFAULT_ISSUE_TERMS;
}

export function preferredIssueProvider(
  selected: IssueProviderType | null,
  connected: IssueProviderType[],
  repositoryProvider?: string
): IssueProviderType | null {
  if (selected && connected.includes(selected)) return selected;
  return connected.find((provider) => provider === repositoryProvider) ?? connected[0] ?? null;
}

export function isIssueIntegration(
  integration: IntegrationProviderDescriptor
): integration is IntegrationProviderDescriptor & { id: IssueProviderType } {
  return integration.features.includes('issues');
}

export function formatIntegrationId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getIntegrationName(
  integrationById: Partial<Record<string, IntegrationProviderDescriptor>>,
  provider: string
): string {
  return integrationById[provider]?.name ?? formatIntegrationId(provider);
}

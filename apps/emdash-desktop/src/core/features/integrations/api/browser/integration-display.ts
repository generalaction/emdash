import type { IssueProviderType } from '@core/primitives/issue-providers/api';
import type { IntegrationProviderDescriptor } from '../contract';

export const ISSUE_FEATURE_LABELS: Record<string, string> = {
  issues: 'Issues',
  pullRequests: 'Pull Requests',
  repositories: 'Repositories',
};

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

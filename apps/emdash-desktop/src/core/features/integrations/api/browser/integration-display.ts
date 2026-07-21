import type { IntegrationMetadata } from '@core/features/integrations/api/browser/integrations-provider';
import type { IssueProviderType } from '@core/primitives/issue-providers/api';

export const ISSUE_FEATURE_LABELS: Record<string, string> = {
  issues: 'Issues',
  pullRequests: 'Pull Requests',
  repositories: 'Repositories',
};

export function isIssueIntegration(
  integration: IntegrationMetadata
): integration is IntegrationMetadata & { id: IssueProviderType } {
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
  integrationById: Partial<Record<string, IntegrationMetadata>>,
  provider: string
): string {
  return integrationById[provider]?.name ?? formatIntegrationId(provider);
}

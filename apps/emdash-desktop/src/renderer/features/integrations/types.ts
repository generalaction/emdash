import type { IssueProviderType } from '@shared/issue-providers';

export type SetupIntegrationType = Exclude<IssueProviderType, 'github'>;

export type ProviderInput = {
  linear: string;
  jira: { siteUrl: string; email: string; token: string };
  gitlab: { instanceUrl: string; token: string };
  plane: { apiBaseUrl: string; workspaceSlug: string; token: string };
  plain: string;
  forgejo: { instanceUrl: string; token: string };
  featurebase: string;
  asana: string;
  monday: { token: string; boardUrls: string };
  trello: { apiKey: string; token: string; boardUrls: string };
};

import type { IssueProviderType } from '@shared/issue-providers';
import type { SetupIntegrationType } from './types';

export const ISSUE_PROVIDER_ORDER: IssueProviderType[] = [
  'github',
  'linear',
  'jira',
  'gitlab',
  'plane',
  'forgejo',
  'trello',
  'asana',
  'monday',
  'featurebase',
  'plain',
];

export const ISSUE_FEATURE_LABELS: Record<string, string> = {
  issues: 'Issues',
  pullRequests: 'Pull Requests',
  repositories: 'Repositories',
};

export const ISSUE_PROVIDER_META: Record<
  IssueProviderType,
  {
    displayName: string;
    description: string;
    features: string[];
    disconnectCredentialLabel?: string;
  }
> = {
  linear: {
    displayName: 'Linear',
    description: 'Work on Linear tickets',
    features: ['issues'],
    disconnectCredentialLabel: 'API key',
  },
  github: {
    displayName: 'GitHub',
    description: 'Work on GitHub issues and PRs',
    features: ['issues', 'pullRequests', 'repositories'],
  },
  jira: {
    displayName: 'Jira',
    description: 'Work on Jira tickets',
    features: ['issues'],
    disconnectCredentialLabel: 'credentials',
  },
  gitlab: {
    displayName: 'GitLab',
    description: 'Work on GitLab issues',
    features: ['issues'],
    disconnectCredentialLabel: 'credentials',
  },
  plane: {
    displayName: 'Plane',
    description: 'Work on Plane work items',
    features: ['issues'],
    disconnectCredentialLabel: 'credentials',
  },
  asana: {
    displayName: 'Asana',
    description: 'Work on Asana tasks',
    features: ['issues'],
    disconnectCredentialLabel: 'access token',
  },
  monday: {
    displayName: 'Monday.com',
    description: 'Work on Monday.com items',
    features: ['issues'],
    disconnectCredentialLabel: 'API token',
  },
  trello: {
    displayName: 'Trello',
    description: 'Work on Trello cards',
    features: ['issues'],
    disconnectCredentialLabel: 'credentials',
  },
  forgejo: {
    displayName: 'Forgejo',
    description: 'Work on Forgejo issues',
    features: ['issues'],
    disconnectCredentialLabel: 'credentials',
  },
  featurebase: {
    displayName: 'Featurebase',
    description: 'Work on Featurebase posts',
    features: ['issues'],
    disconnectCredentialLabel: 'API key',
  },
  plain: {
    displayName: 'Plain',
    description: 'Work on Plain threads',
    features: ['issues'],
    disconnectCredentialLabel: 'API key',
  },
};

export const SETUP_PROVIDER_META: Record<
  SetupIntegrationType,
  {
    title: string;
    subtitle: string;
  }
> = {
  linear: {
    title: 'Connect Linear',
    subtitle: 'Enter your Linear API key to connect your workspace.',
  },
  jira: {
    title: 'Connect Jira',
    subtitle: 'Enter your Jira site URL, email, and API token to connect.',
  },
  gitlab: {
    title: 'Connect GitLab',
    subtitle: 'Enter your GitLab instance URL and personal access token.',
  },
  plane: {
    title: 'Connect Plane',
    subtitle: 'Enter your Plane API base URL, workspace slug, and API key.',
  },
  plain: {
    title: 'Connect Plain',
    subtitle: 'Enter your Plain API key to connect your workspace.',
  },
  forgejo: {
    title: 'Connect Forgejo',
    subtitle: 'Enter your Forgejo instance URL and API token.',
  },
  featurebase: {
    title: 'Connect Featurebase',
    subtitle: 'Enter your Featurebase API key to connect your workspace.',
  },
  asana: {
    title: 'Connect Asana',
    subtitle: 'Enter your Asana personal access token to connect your workspace.',
  },
  monday: {
    title: 'Connect Monday.com',
    subtitle: 'Enter your Monday.com API token and optionally specify board URLs.',
  },
  trello: {
    title: 'Connect Trello',
    subtitle: 'Enter your Trello API key and token, and optionally specify board URLs.',
  },
};

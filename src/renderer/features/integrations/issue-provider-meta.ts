import type { IssueProviderType } from '@shared/issue-providers';

export const ISSUE_PROVIDER_ORDER: IssueProviderType[] = [
  'linear',
  'github',
  'jira',
  'gitlab',
  'asana',
  'monday',
  'trello',
  'forgejo',
  'featurebase',
  'plain',
];

export const ISSUE_PROVIDER_META: Record<
  IssueProviderType,
  {
    displayName: string;
  }
> = {
  linear: { displayName: 'Linear' },
  github: { displayName: 'GitHub' },
  jira: { displayName: 'Jira' },
  gitlab: { displayName: 'GitLab' },
  asana: { displayName: 'Asana' },
  monday: { displayName: 'Monday.com' },
  trello: { displayName: 'Trello' },
  forgejo: { displayName: 'Forgejo' },
  featurebase: { displayName: 'Featurebase' },
  plain: { displayName: 'Plain' },
};

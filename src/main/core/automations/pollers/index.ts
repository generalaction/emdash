import type { IntegrationProvider } from '@shared/automations/events';
import { githubPoller } from './github-poller';
import { makeIssueProviderPoller } from './issue-provider-poller';
import type { Poller } from './types';

export const pollersByProvider: Record<IntegrationProvider, Poller> = {
  github: githubPoller,
  gitlab: makeIssueProviderPoller('gitlab', { requiresLocalPath: true }),
  forgejo: makeIssueProviderPoller('forgejo', { requiresLocalPath: true }),
  jira: makeIssueProviderPoller('jira'),
  linear: makeIssueProviderPoller('linear'),
  plain: makeIssueProviderPoller('plain'),
};

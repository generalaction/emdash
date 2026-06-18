import { asanaIssueProvider } from '@main/core/asana/asana-issue-provider';
import { featurebaseIssueProvider } from '@main/core/featurebase/featurebase-issue-provider';
import { forgejoIssueProvider } from '@main/core/forgejo/forgejo-issue-provider';
import { githubIssueProvider } from '@main/core/github/github-issue-provider';
import { gitlabIssueProvider } from '@main/core/gitlab/gitlab-issue-provider';
import { jiraIssueProvider } from '@main/core/jira/jira-issue-provider';
import { linearIssueProvider } from '@main/core/linear/linear-issue-provider';
import { mondayIssueProvider } from '@main/core/monday/monday-issue-provider';
import { plainIssueProvider } from '@main/core/plain/plain-issue-provider';
import { planeIssueProvider } from '@main/core/plane/plane-issue-provider';
import { trelloIssueProvider } from '@main/core/trello/trello-issue-provider';
import type { IssueProviderType } from '@shared/issue-providers';
import type { IssueProvider } from './issue-provider';

const providers = new Map<IssueProviderType, IssueProvider>();

function register(provider: IssueProvider) {
  providers.set(provider.type, provider);
}

register(linearIssueProvider);
register(githubIssueProvider);
register(jiraIssueProvider);
register(gitlabIssueProvider);
register(forgejoIssueProvider);
register(planeIssueProvider);
register(featurebaseIssueProvider);
register(plainIssueProvider);
register(asanaIssueProvider);
register(mondayIssueProvider);
register(trelloIssueProvider);

export function getIssueProvider(type: IssueProviderType): IssueProvider | undefined {
  return providers.get(type);
}

export function getAllIssueProviders(): IssueProvider[] {
  return [...providers.values()];
}

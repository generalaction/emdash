import type { IssueProviderType } from '@shared/issue-providers';
import { forgejoIssueProvider } from '@main/core/forgejo/forgejo-issue-provider';
import { githubIssueProvider } from '@main/core/github/github-issue-provider';
import { gitlabIssueProvider } from '@main/core/gitlab/gitlab-issue-provider';
import { jiraIssueProvider } from '@main/core/jira/jira-issue-provider';
import { linearIssueProvider } from '@main/core/linear/linear-issue-provider';
import { plainIssueProvider } from '@main/core/plain/plain-issue-provider';
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
register(plainIssueProvider);

export function getIssueProvider(type: IssueProviderType): IssueProvider | undefined {
  return providers.get(type);
}

export function getAllIssueProviders(): IssueProvider[] {
  return [...providers.values()];
}

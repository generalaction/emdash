import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { IntegrationCredentials } from '../../../integrations/host';
import {
  createGitHubClient,
  readGitHubCredentials,
} from '../../../integrations/impl/github/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult } from '../../types';
import { toIssueData } from './mapper';
import { resolveGitHubRepository } from './repo-resolver';

export async function listIssues(
  credentials: IntegrationCredentials,
  repositoryUrl: string | undefined,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readGitHubCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const repository = resolveGitHubRepository(parsedCredentials.data, repositoryUrl);
  if (!repository.success) return err(repository.error);

  const octokit = createGitHubClient(parsedCredentials.data);

  try {
    const { data } = await octokit.rest.issues.listForRepo({
      owner: repository.data.owner,
      repo: repository.data.repo,
      state: 'open',
      per_page: clampIssueLimit(limit, 50, 100),
      sort: 'updated',
      direction: 'desc',
    });

    return ok(data.filter((issue) => !issue.pull_request).map(toIssueData));
  } catch (error) {
    return err(toIntegrationError(error, 'GitHub'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  repositoryUrl: string | undefined,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readGitHubCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const repository = resolveGitHubRepository(parsedCredentials.data, repositoryUrl);
  if (!repository.success) return err(repository.error);

  const octokit = createGitHubClient(parsedCredentials.data);

  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `${term} repo:${repository.data.slug} is:issue is:open`,
      per_page: clampIssueLimit(limit, 20, 100),
      sort: 'updated',
      order: 'desc',
    });

    return ok(data.items.map(toIssueData));
  } catch (error) {
    return err(toIntegrationError(error, 'GitHub'));
  }
}

const plugin = defineIssuesPlugin(
  { integrationId: 'github' },
  { issues: { requiredInputs: ['repositoryUrl'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.repositoryUrl, opts.limit),
    searchIssues: (host, opts) =>
      searchIssues(host.credentials, opts.repositoryUrl, opts.searchTerm, opts.limit),
  },
});

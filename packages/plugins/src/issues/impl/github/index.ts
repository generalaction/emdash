import { err, ok } from '@emdash/shared';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createGitHubClient,
  readGitHubCredentials,
} from '../../../integrations/impl/github/client';
import { toGitHubIntegrationError } from '../../../integrations/impl/github/error';
import { resolveGitHubRepository } from '../../../integrations/impl/github/repo-resolver';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult, IssueQueryOpts, IssueSearchOpts } from '../../types';
import { toIssueData } from './mapper';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readGitHubCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const repository = resolveGitHubRepository(parsedCredentials.data, opts.repositoryUrl);
  if (!repository.success) return err(repository.error);

  const octokit = createGitHubClient(parsedCredentials.data);

  try {
    const { data } = await octokit.rest.issues.listForRepo({
      owner: repository.data.owner,
      repo: repository.data.repo,
      state: 'open',
      per_page: clampIssueLimit(opts.limit, 50, 100),
      sort: 'updated',
      direction: 'desc',
    });

    return ok(data.filter((issue) => !issue.pull_request).map(toIssueData));
  } catch (error) {
    host.log.warn('GitHub listIssues failed', { error });
    return err(toGitHubIntegrationError(error, 'Unable to fetch GitHub issues.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readGitHubCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const repository = resolveGitHubRepository(parsedCredentials.data, opts.repositoryUrl);
  if (!repository.success) return err(repository.error);

  const octokit = createGitHubClient(parsedCredentials.data);

  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `${term} repo:${repository.data.slug} is:issue is:open`,
      per_page: clampIssueLimit(opts.limit, 20, 100),
      sort: 'updated',
      order: 'desc',
    });

    return ok(data.items.map(toIssueData));
  } catch (error) {
    host.log.warn('GitHub searchIssues failed', { error });
    return err(toGitHubIntegrationError(error, 'Unable to search GitHub issues.'));
  }
}

const plugin = defineIssuesPlugin(
  { integrationId: 'github' },
  { issues: { requiredInputs: ['repositoryUrl'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues },
});

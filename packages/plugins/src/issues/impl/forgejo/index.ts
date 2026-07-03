import { err, ok } from '@emdash/shared';
import { issueListIssues } from '@llamaduck/forgejo-ts';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { IntegrationCredentials } from '../../../integrations/host';
import {
  createForgejoClient,
  readForgejoCredentials,
} from '../../../integrations/impl/forgejo/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult } from '../../types';
import { toIssueData } from './mapper';
import { resolveForgejoRepository } from './repo-resolver';

export async function listIssues(
  credentials: IntegrationCredentials,
  repositoryUrl: string | undefined,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readForgejoCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const repository = resolveForgejoRepository(parsedCredentials.data, repositoryUrl);
  if (!repository.success) return err(repository.error);

  const client = createForgejoClient(parsedCredentials.data);

  try {
    const { data: issues } = await issueListIssues({
      client,
      path: { owner: repository.data.owner, repo: repository.data.repo },
      query: {
        state: 'open',
        type: 'issues',
        sort: 'recentupdate',
        limit: clampIssueLimit(limit, 50, 100),
      },
      throwOnError: true,
    });

    return ok((issues ?? []).map((issue) => toIssueData(issue, repository.data.repoName)));
  } catch (error) {
    return err(toIntegrationError(error, 'Forgejo'));
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

  const parsedCredentials = readForgejoCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const repository = resolveForgejoRepository(parsedCredentials.data, repositoryUrl);
  if (!repository.success) return err(repository.error);

  const client = createForgejoClient(parsedCredentials.data);

  try {
    const { data: issues } = await issueListIssues({
      client,
      path: { owner: repository.data.owner, repo: repository.data.repo },
      query: {
        state: 'open',
        type: 'issues',
        q: term,
        sort: 'recentupdate',
        limit: clampIssueLimit(limit, 20, 100),
      },
      throwOnError: true,
    });

    return ok((issues ?? []).map((issue) => toIssueData(issue, repository.data.repoName)));
  } catch (error) {
    return err(toIntegrationError(error, 'Forgejo'));
  }
}

const plugin = defineIssuesPlugin(
  { integrationId: 'forgejo' },
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

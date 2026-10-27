import { err, ok } from '@emdash/shared';
import { issueListIssues } from '@llamaduck/forgejo-ts';
import { toIntegrationError } from '../../../integrations/helpers/error';
import { resolveRemoteRepository } from '../../../integrations/helpers/repository-remote';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createForgejoClient,
  readForgejoCredentials,
} from '../../../integrations/impl/forgejo/client';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult, IssueQueryOpts, IssueSearchOpts } from '../../types';
import { toIssueData } from './mapper';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readForgejoCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const repository = resolveRemoteRepository(
    opts.repositoryUrl,
    parsedCredentials.data.instanceUrl,
    'Forgejo'
  );
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
        limit: clampIssueLimit(opts.limit, 50, 100),
      },
      throwOnError: true,
    });

    return ok((issues ?? []).map((issue) => toIssueData(issue, repository.data.repo)));
  } catch (error) {
    host.log.warn('Forgejo listIssues failed', { error });
    return err(toIntegrationError(error, 'Forgejo', 'Unable to fetch Forgejo issues.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readForgejoCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const repository = resolveRemoteRepository(
    opts.repositoryUrl,
    parsedCredentials.data.instanceUrl,
    'Forgejo'
  );
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
        limit: clampIssueLimit(opts.limit, 20, 100),
      },
      throwOnError: true,
    });

    return ok((issues ?? []).map((issue) => toIssueData(issue, repository.data.repo)));
  } catch (error) {
    host.log.warn('Forgejo searchIssues failed', { error });
    return err(toIntegrationError(error, 'Forgejo', 'Unable to search Forgejo issues.'));
  }
}

const plugin = defineIssuesPlugin(
  { integrationId: 'forgejo' },
  { issues: { requiredInputs: ['repositoryUrl'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues },
});

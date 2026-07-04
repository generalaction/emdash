import { err, ok } from '@emdash/shared';
import type { ThreadsSort, ThreadStatus } from '@team-plain/graphql';
import type { IntegrationCredentials } from '../../../integrations/host';
import { createPlainClient, readPlainCredentials } from '../../../integrations/impl/plain/client';
import { toPlainIntegrationError } from '../../../integrations/impl/plain/error';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueGetResult, IssueListResult } from '../../types';
import { getPlainIssueDetails } from './context';
import { toIssueData } from './mapper';
import { queryPlainThread } from './queries';

const SEARCH_MIN_LENGTH = 2;
const THREAD_STATUSES = ['TODO', 'SNOOZED', 'DONE'] satisfies ThreadStatus[];
const RECENT_THREADS_SORT = {
  field: 'CREATED_AT',
  direction: 'DESC',
} satisfies ThreadsSort;

export async function listIssues(
  credentials: IntegrationCredentials,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readPlainCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createPlainClient(parsedCredentials.data);
  const first = clampIssueLimit(limit, 50, 100);
  try {
    const connection = await client.query.threads({
      filters: { statuses: THREAD_STATUSES },
      sortBy: RECENT_THREADS_SORT,
      first,
    });

    return ok(connection.nodes.map(toIssueData));
  } catch (error) {
    return err(toPlainIntegrationError(error, 'Failed to fetch Plain threads.'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (term.length < SEARCH_MIN_LENGTH) return ok([]);
  const parsedCredentials = readPlainCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createPlainClient(parsedCredentials.data);
  const first = clampIssueLimit(limit, 20, 100);
  try {
    const result = await client.query.searchThreads({ searchQuery: { term }, first });
    return ok(result.edges.map((edge) => toIssueData(edge.node.thread)));
  } catch (error) {
    return err(toPlainIntegrationError(error, 'Failed to search Plain threads.'));
  }
}

export async function getIssue(
  credentials: IntegrationCredentials,
  identifier: string
): Promise<IssueGetResult> {
  const term = normalizeSearchTerm(identifier);
  if (!term) {
    return err({
      type: 'invalid_input',
      message: 'Plain thread identifier is required.',
    });
  }
  const parsedCredentials = readPlainCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);
  const client = createPlainClient(parsedCredentials.data);
  try {
    const thread = await queryPlainThread(client, term);
    if (!thread) {
      return err({ type: 'not_found_or_no_access', message: `Plain thread not found: ${term}` });
    }
    const { context } = await getPlainIssueDetails(thread);
    return ok({ ...toIssueData(thread), context });
  } catch (error) {
    return err(toPlainIntegrationError(error, 'Failed to fetch Plain thread context.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'plain' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.limit),
    searchIssues: (host, opts) => searchIssues(host.credentials, opts.searchTerm, opts.limit),
    getIssue: (host, opts) => getIssue(host.credentials, opts.identifier),
  },
});

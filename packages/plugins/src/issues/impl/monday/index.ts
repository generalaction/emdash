import { err, ok } from '@emdash/shared';
import type { IntegrationCredentials } from '../../../integrations/host';
import {
  createMondayClient,
  readMondayCredentials,
} from '../../../integrations/impl/monday/client';
import { toMondayIntegrationError } from '../../../integrations/impl/monday/error';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { sortByUpdatedAtDesc } from '../../helpers/sort-by-updated-at-desc';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueGetResult, IssueListResult } from '../../types';
import { getMondayIssueContext } from './context';
import { toIssueData, toIssueDetail } from './mapper';
import {
  queryMondayBoards,
  queryMondayItem,
  searchItemsQueryParams,
  updatedItemsQueryParams,
} from './queries';

export async function listIssues(
  credentials: IntegrationCredentials,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readMondayCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createMondayClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(limit, 50, 200);

  try {
    const boards = await queryMondayBoards(client, sanitizedLimit, updatedItemsQueryParams());
    const issues = sortByUpdatedAtDesc(
      boards.flatMap((board) => board.items_page.items.map((item) => toIssueData(item, board)))
    );
    return ok(issues.slice(0, sanitizedLimit));
  } catch (error) {
    return err(toMondayIntegrationError(error, 'Failed to fetch Monday.com items.'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readMondayCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createMondayClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(limit, 20, 200);

  try {
    const boards = await queryMondayBoards(client, sanitizedLimit, searchItemsQueryParams(term));
    const issues = sortByUpdatedAtDesc(
      boards.flatMap((board) => board.items_page.items.map((item) => toIssueData(item, board)))
    );
    return ok(issues.slice(0, sanitizedLimit));
  } catch (error) {
    return err(toMondayIntegrationError(error, 'Failed to search Monday.com items.'));
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
      message: 'Monday.com item identifier is required.',
    });
  }

  const parsedCredentials = readMondayCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createMondayClient(parsedCredentials.data);

  try {
    const item = await queryMondayItem(client, term);
    if (!item) return err({ type: 'not_found_or_no_access', message: `Item ${term} not found.` });
    const { description, context } = await getMondayIssueContext(client, item);
    return ok(toIssueDetail(item, item.board, context, description));
  } catch (error) {
    return err(toMondayIntegrationError(error, 'Failed to fetch Monday.com item context.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'monday' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.limit),
    searchIssues: (host, opts) => searchIssues(host.credentials, opts.searchTerm, opts.limit),
    getIssue: (host, opts) => getIssue(host.credentials, opts.identifier),
  },
});

import { err, ok } from '@emdash/shared';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createMondayClient,
  readMondayCredentials,
} from '../../../integrations/impl/monday/client';
import { toMondayIntegrationError } from '../../../integrations/impl/monday/error';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { sortByUpdatedAtDesc } from '../../helpers/sort-by-updated-at-desc';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { getMondayIssueContext } from './context';
import { toIssueData, toIssueDetail } from './mapper';
import {
  queryMondayBoards,
  queryMondayItem,
  searchItemsQueryParams,
  updatedItemsQueryParams,
} from './queries';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readMondayCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createMondayClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(opts.limit, 50, 200);

  try {
    const boards = await queryMondayBoards(client, sanitizedLimit, updatedItemsQueryParams());
    const issues = sortByUpdatedAtDesc(
      boards.flatMap((board) => board.items_page.items.map((item) => toIssueData(item, board)))
    );
    return ok(issues.slice(0, sanitizedLimit));
  } catch (error) {
    host.log.warn('Monday listIssues failed', { error });
    return err(toMondayIntegrationError(error, 'Failed to fetch Monday.com items.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readMondayCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createMondayClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(opts.limit, 20, 200);

  try {
    const boards = await queryMondayBoards(client, sanitizedLimit, searchItemsQueryParams(term));
    const issues = sortByUpdatedAtDesc(
      boards.flatMap((board) => board.items_page.items.map((item) => toIssueData(item, board)))
    );
    return ok(issues.slice(0, sanitizedLimit));
  } catch (error) {
    host.log.warn('Monday searchIssues failed', { error });
    return err(toMondayIntegrationError(error, 'Failed to search Monday.com items.'));
  }
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const term = normalizeSearchTerm(opts.identifier);
  if (!term) {
    return err({
      type: 'invalid_input',
      message: 'Monday.com item identifier is required.',
    });
  }

  const parsedCredentials = readMondayCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createMondayClient(parsedCredentials.data);

  try {
    const item = await queryMondayItem(client, term);
    if (!item) return err({ type: 'not_found_or_no_access', message: `Item ${term} not found.` });
    const { description, context } = await getMondayIssueContext(client, item);
    return ok(toIssueDetail(item, item.board, context, description));
  } catch (error) {
    host.log.warn('Monday getIssue failed', { error });
    return err(toMondayIntegrationError(error, 'Failed to fetch Monday.com item context.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'monday' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue },
});

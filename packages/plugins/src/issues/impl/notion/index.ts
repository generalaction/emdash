import { err, ok } from '@emdash/shared';
import {
  isFullPage,
  type BlockObjectResponse,
  type PageObjectResponse,
  type PartialBlockObjectResponse,
} from '@notionhq/client';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createNotionClient,
  readNotionCredentials,
} from '../../../integrations/impl/notion/client';
import { toNotionIntegrationError } from '../../../integrations/impl/notion/error';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { formatNotionContext } from './context';
import { hasMeaningfulTitle, isDatabasePage, toIssueData, toIssueListItems } from './mapper';

const NOTION_PAGE_SIZE = 100;

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readNotionCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createNotionClient(parsedCredentials.data);
  const limit = clampIssueLimit(opts.limit, 50, 100);

  try {
    const pages: PageObjectResponse[] = [];
    let startCursor: string | null | undefined;

    do {
      const response = await client.search({
        filter: { property: 'object', value: 'page' },
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
        page_size: NOTION_PAGE_SIZE,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      });
      pages.push(...response.results.filter(isFullPage).filter(isDatabasePage));
      startCursor = response.has_more ? response.next_cursor : null;
    } while (startCursor && pages.filter(hasMeaningfulTitle).length < limit);

    return ok(toIssueListItems(pages).slice(0, limit));
  } catch (error) {
    host.log.warn('Notion listIssues failed', { error });
    return err(toNotionIntegrationError(error, 'Unable to fetch Notion pages.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readNotionCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createNotionClient(parsedCredentials.data);
  const limit = clampIssueLimit(opts.limit, 20, 100);

  try {
    const response = await client.search({
      query: term,
      filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' },
      page_size: limit,
    });
    return ok(toIssueListItems(response.results.filter(isFullPage)));
  } catch (error) {
    host.log.warn('Notion searchIssues failed', { error });
    return err(toNotionIntegrationError(error, 'Unable to search Notion pages.'));
  }
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const parsedCredentials = readNotionCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createNotionClient(parsedCredentials.data);

  try {
    const page = await client.pages.retrieve({ page_id: opts.identifier });
    if (!isFullPage(page)) {
      return err({
        type: 'not_found_or_no_access',
        message: 'Notion page was not found or the integration does not have access.',
      });
    }

    const blocks: Array<BlockObjectResponse | PartialBlockObjectResponse> = [];
    let startCursor: string | null | undefined;

    do {
      const response = await client.blocks.children.list({
        block_id: page.id,
        page_size: NOTION_PAGE_SIZE,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      });
      blocks.push(...response.results);
      startCursor = response.has_more ? response.next_cursor : null;
    } while (startCursor);

    return ok({ ...toIssueData(page), context: formatNotionContext(blocks) });
  } catch (error) {
    host.log.warn('Notion getIssue failed', { error });
    return err(toNotionIntegrationError(error, 'Unable to fetch Notion page context.'));
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'notion' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues, getIssue },
});

import { err, ok } from '@emdash/shared';
import { mondayQuery, readMondayCredentials } from '../../../integrations/impl/monday/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { sortByUpdatedAtDesc } from '../../helpers/sort-by-updated-at-desc';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueDetail } from '../../types';

type MondayColumnValue = {
  id: string;
  type: string;
  text: string;
  value?: string;
};

type MondayItem = {
  id: string;
  name: string;
  updated_at: string;
  group?: { title: string };
  column_values: MondayColumnValue[];
};

type MondayBoard = {
  id: string;
  name: string;
  url: string;
  items_page: { items: MondayItem[] };
};

type MondayItemWithContext = MondayItem & {
  board: { id: string; name: string; url: string };
  updates: { id: string; text_body: string; created_at: string; creator: { name: string } }[];
};

const ITEMS_FIELDS = `
  id
  name
  updated_at
  group { title }
  column_values { id type text }
`;

const ORDER_BY_UPDATED_AT_DESC = { column_id: '__last_updated__', direction: 'desc' };

function buildItemUrl(boardUrl: string, itemId: string): string {
  return `${boardUrl}/pulses/${itemId}`;
}

function extractDescription(columnValues: MondayColumnValue[]): string | undefined {
  const longText = columnValues.find((c) => c.type === 'long_text' || c.type === 'text');
  return longText?.text || undefined;
}

function extractDocObjectId(columnValues: MondayColumnValue[]): number | undefined {
  const docColumn = columnValues.find((c) => c.type === 'doc' || c.type === 'direct_doc');
  if (!docColumn?.value) return undefined;

  try {
    const parsed = JSON.parse(docColumn.value);
    const file = parsed?.files?.find(
      (f: { fileType?: string }) => f.fileType === 'MONDAY_DOC_ITEM_DESCRIPTION'
    );
    return file?.objectId;
  } catch {
    return undefined;
  }
}

function toIssue(
  item: MondayItem,
  board: { name: string; url: string },
  context?: string,
  descriptionOverride?: string
): IssueData | IssueDetail {
  const description = descriptionOverride ?? extractDescription(item.column_values);
  return {
    identifier: item.id,
    title: item.name,
    url: buildItemUrl(board.url, item.id),
    description,
    updatedAt: item.updated_at,
    context,
  };
}

function formatContext(updates: MondayItemWithContext['updates']): string | undefined {
  if (!updates.length) return undefined;
  return updates
    .map((u) => `**${u.creator.name}** (${u.created_at}):\n${u.text_body}`)
    .join('\n\n');
}

const plugin = defineIssuesPlugin({ integrationId: 'monday' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    async listIssues(host, opts) {
      const credentials = readMondayCredentials(host.credentials);
      const sanitizedLimit = clampIssueLimit(opts.limit, 50, 200);

      try {
        const queryParams = { order_by: [ORDER_BY_UPDATED_AT_DESC] };
        const query = credentials.boardIds.length
          ? `query ($boardIds: [ID!]!, $limit: Int!, $queryParams: ItemsQuery) {
              boards(ids: $boardIds) { id name url items_page(limit: $limit, query_params: $queryParams) { items { ${ITEMS_FIELDS} } } }
            }`
          : `query ($limit: Int!, $queryParams: ItemsQuery) {
              boards(limit: 20) { id name url items_page(limit: $limit, query_params: $queryParams) { items { ${ITEMS_FIELDS} } } }
            }`;

        const variables = credentials.boardIds.length
          ? { boardIds: credentials.boardIds, limit: sanitizedLimit, queryParams }
          : { limit: sanitizedLimit, queryParams };

        const data = await mondayQuery<{ boards: MondayBoard[] }>(
          credentials.apiToken,
          query,
          variables
        );
        const issues = sortByUpdatedAtDesc(
          data.boards.flatMap((board) =>
            board.items_page.items.map((item) => toIssue(item, board) as IssueData)
          )
        );
        return ok(issues.slice(0, sanitizedLimit));
      } catch (error) {
        return err(
          issueError(
            'generic',
            error instanceof Error ? error.message : 'Failed to fetch Monday.com items.'
          )
        );
      }
    },

    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      const credentials = readMondayCredentials(host.credentials);
      const sanitizedLimit = clampIssueLimit(opts.limit, 20, 200);

      try {
        const queryParams = {
          rules: [{ column_id: 'name', compare_value: [term], operator: 'contains_text' }],
          order_by: [ORDER_BY_UPDATED_AT_DESC],
        };

        const query = credentials.boardIds.length
          ? `query ($boardIds: [ID!]!, $queryParams: ItemsQuery, $limit: Int!) {
              boards(ids: $boardIds) { id name url items_page(limit: $limit, query_params: $queryParams) { items { ${ITEMS_FIELDS} } } }
            }`
          : `query ($queryParams: ItemsQuery, $limit: Int!) {
              boards(limit: 20) { id name url items_page(limit: $limit, query_params: $queryParams) { items { ${ITEMS_FIELDS} } } }
            }`;

        const variables = credentials.boardIds.length
          ? { boardIds: credentials.boardIds, queryParams, limit: sanitizedLimit }
          : { queryParams, limit: sanitizedLimit };

        const data = await mondayQuery<{ boards: MondayBoard[] }>(
          credentials.apiToken,
          query,
          variables
        );
        const issues = sortByUpdatedAtDesc(
          data.boards.flatMap((board) =>
            board.items_page.items.map((item) => toIssue(item, board) as IssueData)
          )
        );
        return ok(issues.slice(0, sanitizedLimit));
      } catch (error) {
        return err(
          issueError(
            'generic',
            error instanceof Error ? error.message : 'Failed to search Monday.com items.'
          )
        );
      }
    },

    async getIssue(host, opts) {
      const credentials = readMondayCredentials(host.credentials);
      try {
        const query = `query ($itemId: [ID!]!) {
          items(ids: $itemId) {
            id name updated_at
            board { id name url }
            group { title }
            column_values { id type text value }
            updates(limit: 25) { id text_body created_at creator { name } }
          }
        }`;

        const data = await mondayQuery<{ items: MondayItemWithContext[] }>(
          credentials.apiToken,
          query,
          { itemId: [opts.identifier] }
        );

        const item = data.items[0];
        if (!item)
          return err(issueError('not_found_or_no_access', `Item ${opts.identifier} not found.`));

        const description =
          extractDescription(item.column_values) ??
          (await fetchDocDescription(credentials.apiToken, item.column_values));
        return ok(
          toIssue(item, item.board, formatContext(item.updates), description) as IssueDetail
        );
      } catch (error) {
        return err(
          issueError(
            'generic',
            error instanceof Error ? error.message : 'Failed to fetch Monday.com item context.'
          )
        );
      }
    },
  },
});

async function fetchDocDescription(
  token: string,
  columnValues: MondayColumnValue[]
): Promise<string | undefined> {
  const objectId = extractDocObjectId(columnValues);
  if (!objectId) return undefined;

  try {
    const exportQuery = `query ($docId: ID!) {
      export_markdown_from_doc(docId: $docId) { markdown }
    }`;
    const data = await mondayQuery<{ export_markdown_from_doc: { markdown: string } | null }>(
      token,
      exportQuery,
      { docId: String(objectId) }
    );
    return data.export_markdown_from_doc?.markdown?.trim() || undefined;
  } catch {
    return undefined;
  }
}

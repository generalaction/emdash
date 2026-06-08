import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@main/core/issues/issue-provider';
import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type IssueContextResult,
  type IssueListResult,
} from '@shared/issue-providers';
import { mondayConnectionService } from './monday-connection-service';

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
): LinkedIssue {
  const description = descriptionOverride ?? extractDescription(item.column_values);

  return {
    provider: 'monday',
    identifier: item.id,
    title: item.name,
    url: buildItemUrl(board.url, item.id),
    description,
    updatedAt: item.updated_at,
    fetchedAt: new Date().toISOString(),
    context,
  };
}

function formatContext(updates: MondayItemWithContext['updates']): string | undefined {
  if (!updates.length) return undefined;

  return updates
    .map((u) => `**${u.creator.name}** (${u.created_at}):\n${u.text_body}`)
    .join('\n\n');
}

const ORDER_BY_UPDATED_AT_DESC = { column_id: '__last_updated__', direction: 'desc' };

function sortByUpdatedAtDesc(issues: LinkedIssue[]): LinkedIssue[] {
  return issues.sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const credentials = await mondayConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Monday.com is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(limit, 50, 200);

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

    const data = await mondayConnectionService.query<{ boards: MondayBoard[] }>(
      credentials.token,
      query,
      variables
    );

    const issues = sortByUpdatedAtDesc(
      data.boards.flatMap((board) => board.items_page.items.map((item) => toIssue(item, board)))
    );

    return { success: true, issues: issues.slice(0, sanitizedLimit) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch Monday.com items.',
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  const credentials = await mondayConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Monday.com is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(limit, 20, 200);

  try {
    const queryParams = {
      rules: [{ column_id: 'name', compare_value: [term], operator: 'contains_text' }],
      order_by: [ORDER_BY_UPDATED_AT_DESC],
    };

    const query = credentials.boardIds.length
      ? `query ($boardIds: [ID!]!, $queryParams: ItemsQuery, $limit: Int!) {
          boards(ids: $boardIds) {
            id name url
            items_page(limit: $limit, query_params: $queryParams) {
              items { ${ITEMS_FIELDS} }
            }
          }
        }`
      : `query ($queryParams: ItemsQuery, $limit: Int!) {
          boards(limit: 20) {
            id name url
            items_page(limit: $limit, query_params: $queryParams) {
              items { ${ITEMS_FIELDS} }
            }
          }
        }`;

    const variables = credentials.boardIds.length
      ? { boardIds: credentials.boardIds, queryParams, limit: sanitizedLimit }
      : { queryParams, limit: sanitizedLimit };

    const data = await mondayConnectionService.query<{ boards: MondayBoard[] }>(
      credentials.token,
      query,
      variables
    );

    const issues = sortByUpdatedAtDesc(
      data.boards.flatMap((board) => board.items_page.items.map((item) => toIssue(item, board)))
    );

    return { success: true, issues: issues.slice(0, sanitizedLimit) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search Monday.com items.',
    };
  }
}

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

    const data = await mondayConnectionService.query<{
      export_markdown_from_doc: { markdown: string } | null;
    }>(token, exportQuery, { docId: String(objectId) });

    return data.export_markdown_from_doc?.markdown?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function getIssueContext(opts: IssueContextOpts): Promise<IssueContextResult> {
  const credentials = await mondayConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Monday.com is not connected.' };
  }

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

    const data = await mondayConnectionService.query<{ items: MondayItemWithContext[] }>(
      credentials.token,
      query,
      { itemId: [opts.identifier] }
    );

    const item = data.items[0];
    if (!item) {
      return { success: false, error: `Item ${opts.identifier} not found.` };
    }

    const description =
      extractDescription(item.column_values) ??
      (await fetchDocDescription(credentials.token, item.column_values));
    const context = formatContext(item.updates);
    const issue = toIssue(item, item.board, context, description);
    return { success: true, issue };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch Monday.com item context.',
    };
  }
}

export const mondayIssueProvider: IssueProvider = {
  type: 'monday',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.monday,
  checkConnection: () => mondayConnectionService.checkConnection(),
  listIssues: async (opts: IssueQueryOpts) => listIssues(opts.limit ?? 50),
  searchIssues: async (opts: IssueSearchOpts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
  getIssueContext,
};

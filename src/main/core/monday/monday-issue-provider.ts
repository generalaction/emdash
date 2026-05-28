import { clampIssueLimit } from '@main/core/issues/helpers/provider-inputs';
import type {
  IssueContextOpts,
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@main/core/issues/issue-provider';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type IssueContextResult,
  type IssueListResult,
} from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { mondayConnectionService } from './monday-connection-service';

type MondayColumnValue = {
  id: string;
  type: string;
  text: string;
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

function toIssue(
  item: MondayItem,
  board: { name: string; url: string },
  context?: string
): Issue {
  const status = item.column_values.find((c) => c.type === 'status')?.text || undefined;
  const assigneesRaw = item.column_values.find((c) => c.type === 'people')?.text;
  const assignees = assigneesRaw
    ? assigneesRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  return {
    provider: 'monday',
    identifier: item.id,
    title: item.name,
    url: buildItemUrl(board.url, item.id),
    status,
    assignees,
    project: board.name,
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

async function listIssues(limit: number): Promise<IssueListResult> {
  const credentials = await mondayConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Monday.com is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(limit, 50, 200);

  try {
    const query = credentials.boardIds.length
      ? `query ($boardIds: [ID!]!, $limit: Int!) {
          boards(ids: $boardIds) { id name url items_page(limit: $limit) { items { ${ITEMS_FIELDS} } } }
        }`
      : `query ($limit: Int!) {
          boards(limit: 20) { id name url items_page(limit: $limit) { items { ${ITEMS_FIELDS} } } }
        }`;

    const variables = credentials.boardIds.length
      ? { boardIds: credentials.boardIds, limit: sanitizedLimit }
      : { limit: sanitizedLimit };

    const data = await mondayConnectionService.query<{ boards: MondayBoard[] }>(
      credentials.token,
      query,
      variables
    );

    const issues: Issue[] = data.boards.flatMap((board) =>
      board.items_page.items.map((item) => toIssue(item, board))
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
  const credentials = await mondayConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Monday.com is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(limit, 20, 200);

  try {
    const query = credentials.boardIds.length
      ? `query ($boardIds: [ID!]!, $term: String!, $limit: Int!) {
          boards(ids: $boardIds) {
            id name url
            items_page(limit: $limit, query_params: { rules: [{ column_id: "name", compare_value: [$term], operator: contains_text }] }) {
              items { ${ITEMS_FIELDS} }
            }
          }
        }`
      : `query ($term: String!, $limit: Int!) {
          boards(limit: 20) {
            id name url
            items_page(limit: $limit, query_params: { rules: [{ column_id: "name", compare_value: [$term], operator: contains_text }] }) {
              items { ${ITEMS_FIELDS} }
            }
          }
        }`;

    const variables = credentials.boardIds.length
      ? { boardIds: credentials.boardIds, term: searchTerm, limit: sanitizedLimit }
      : { term: searchTerm, limit: sanitizedLimit };

    const data = await mondayConnectionService.query<{ boards: MondayBoard[] }>(
      credentials.token,
      query,
      variables
    );

    const issues: Issue[] = data.boards.flatMap((board) =>
      board.items_page.items.map((item) => toIssue(item, board))
    );

    return { success: true, issues: issues.slice(0, sanitizedLimit) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search Monday.com items.',
    };
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
        column_values { id type text }
        updates { id text_body created_at creator { name } }
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

    const context = formatContext(item.updates);
    const issue = toIssue(item, item.board, context);
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

import { mapWithConcurrency } from '@main/core/issues/helpers/map-with-concurrency';
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
import {
  getNotionIssueErrorType,
  notionConnectionService,
  type NotionCredentials,
} from './notion-connection-service';

type NotionRichText = { plain_text?: string };
type NotionProperty = {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  status?: { name?: string | null } | null;
  select?: { name?: string | null } | null;
  people?: { name?: string | null }[];
  last_edited_time?: string;
};

type NotionPage = {
  object: 'page';
  id: string;
  url: string;
  parent?: { type?: string; database_id?: string; data_source_id?: string };
  last_edited_time?: string;
  properties: Record<string, NotionProperty>;
};

type NotionSearchResponse = {
  results: (NotionPage | NotionDataSource)[];
  has_more: boolean;
  next_cursor?: string | null;
};

type NotionDataSource = {
  object: 'data_source';
  id: string;
  url: string;
  title?: NotionRichText[];
  parent?: { type?: string; database_id?: string };
};

type NotionDataSourceQueryResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string | null;
};

type NotionBlockChildrenResponse = {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor?: string | null;
};

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

const BLOCK_CONTEXT_PAGE_SIZE = 100;
const MAX_CONTEXT_BLOCKS = 300;
const MAX_CONTEXT_DEPTH = 3;
const NOTION_DATA_SOURCE_CONCURRENCY = 4;
const DATA_SOURCE_QUERY_PAGE_SIZE = 100;

function plainText(value: NotionRichText[] | undefined): string | undefined {
  const text = value
    ?.map((part) => part.plain_text ?? '')
    .join('')
    .trim();
  return text || undefined;
}

function findProperty(
  page: NotionPage,
  types: string[],
  preferredNames: string[] = []
): NotionProperty | undefined {
  const entries = Object.entries(page.properties);
  for (const name of preferredNames) {
    const property = page.properties[name];
    if (property && types.includes(property.type)) return property;
  }

  return entries.find(([, property]) => types.includes(property.type))?.[1];
}

function getTitle(page: NotionPage): string {
  const property = findProperty(page, ['title']);
  if (property?.type !== 'title') return 'Untitled Notion page';
  return plainText(property.title) ?? 'Untitled Notion page';
}

function getDescription(page: NotionPage): string | undefined {
  const property = findProperty(
    page,
    ['rich_text'],
    ['Description', 'Summary', 'Details', 'Context']
  );
  return property?.type === 'rich_text' ? plainText(property.rich_text) : undefined;
}

function getStatus(page: NotionPage): string | undefined {
  const property = findProperty(page, ['status', 'select'], ['Status', 'State']);
  if (property?.type === 'status') return property.status?.name ?? undefined;
  if (property?.type === 'select') return property.select?.name ?? undefined;
  return undefined;
}

function getAssignees(page: NotionPage): string[] | undefined {
  const property = findProperty(page, ['people'], ['Assignee', 'Assignees', 'Owner']);
  if (property?.type !== 'people') return undefined;

  const assignees = property.people?.map((person) => person.name).filter(Boolean) ?? [];
  return assignees.length ? (assignees as string[]) : undefined;
}

function toIssue(page: NotionPage, context?: string): LinkedIssue {
  return {
    provider: 'notion',
    identifier: page.id,
    title: getTitle(page),
    url: page.url,
    description: getDescription(page),
    status: getStatus(page),
    assignees: getAssignees(page),
    updatedAt: page.last_edited_time,
    fetchedAt: new Date().toISOString(),
    context,
  };
}

function sortByUpdatedAtDesc(issues: LinkedIssue[]): LinkedIssue[] {
  return [...issues].sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}

function issueMatchesTerm(issue: LinkedIssue, term: string): boolean {
  const normalizedTerm = term.toLowerCase();
  return [
    issue.title,
    issue.description,
    issue.status,
    issue.project,
    ...(issue.assignees ?? []),
  ].some((value) => value?.toLowerCase().includes(normalizedTerm));
}

async function searchSharedPages(
  credentials: NotionCredentials,
  searchTerm: string | undefined,
  limit: number
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      page_size: Math.min(100, limit),
      filter: { property: 'object', value: 'page' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    };
    if (searchTerm) body.query = searchTerm;
    if (startCursor) body.start_cursor = startCursor;

    const data = await notionConnectionService.request<NotionSearchResponse>(
      credentials.token,
      '/search',
      { method: 'POST', body: JSON.stringify(body) }
    );

    pages.push(...data.results.filter((result) => result.object === 'page'));
    startCursor = data.next_cursor ?? undefined;
  } while (startCursor && pages.length < limit);

  return pages.slice(0, limit);
}

async function searchSharedDataSources(credentials: NotionCredentials): Promise<NotionDataSource[]> {
  const dataSources: NotionDataSource[] = [];
  let startCursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      page_size: 100,
      filter: { property: 'object', value: 'data_source' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    };
    if (startCursor) body.start_cursor = startCursor;

    const data = await notionConnectionService.request<NotionSearchResponse>(
      credentials.token,
      '/search',
      { method: 'POST', body: JSON.stringify(body) }
    );

    dataSources.push(...data.results.filter((result) => result.object === 'data_source'));
    startCursor = data.next_cursor ?? undefined;
  } while (startCursor);

  return dataSources;
}

async function queryDataSourcePageBatch(
  token: string,
  dataSourceId: string,
  startCursor?: string
): Promise<NotionDataSourceQueryResponse> {
  const body: Record<string, unknown> = {
    page_size: DATA_SOURCE_QUERY_PAGE_SIZE,
    sorts: [{ direction: 'descending', timestamp: 'last_edited_time' }],
  };
  if (startCursor) body.start_cursor = startCursor;

  return notionConnectionService.request<NotionDataSourceQueryResponse>(
    token,
    `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

async function queryDataSourcePages(
  token: string,
  dataSourceId: string,
  limit: number
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const data = await queryDataSourcePageBatch(token, dataSourceId, startCursor);
    pages.push(...data.results);
    startCursor = data.next_cursor ?? undefined;
  } while (startCursor && pages.length < limit);

  return pages.slice(0, limit);
}

async function searchDataSourceIssues(
  token: string,
  dataSourceId: string,
  searchTerm: string,
  limit: number
): Promise<LinkedIssue[]> {
  const issues: LinkedIssue[] = [];
  let startCursor: string | undefined;

  do {
    const data = await queryDataSourcePageBatch(token, dataSourceId, startCursor);
    for (const page of data.results) {
      const issue = toIssue(page);
      if (issueMatchesTerm(issue, searchTerm)) {
        issues.push(issue);
        if (issues.length >= limit) break;
      }
    }
    startCursor = data.next_cursor ?? undefined;
  } while (startCursor && issues.length < limit);

  return issues;
}

function dedupeIssuesByIdentifier(issues: LinkedIssue[]): LinkedIssue[] {
  return [...new Map(issues.map((issue) => [issue.identifier, issue])).values()];
}

function toIssueListError(error: unknown, fallback: string): IssueListResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
    errorType: getNotionIssueErrorType(error),
  };
}

async function listScopedIssues(
  credentials: NotionCredentials,
  searchTerm: string | undefined,
  limit: number
): Promise<LinkedIssue[]> {
  if (credentials.scope.type === 'all-shared') {
    if (!searchTerm) {
      const dataSources = await searchSharedDataSources(credentials);
      const pagesBySource = await mapWithConcurrency(
        dataSources,
        NOTION_DATA_SOURCE_CONCURRENCY,
        (dataSource) => queryDataSourcePages(credentials.token, dataSource.id, limit)
      );
      const dataSourceIssues = pagesBySource.flat().map((page) => toIssue(page));
      const sharedPageIssues = (await searchSharedPages(credentials, undefined, limit)).map((page) =>
        toIssue(page)
      );
      return sortByUpdatedAtDesc(
        dedupeIssuesByIdentifier([...dataSourceIssues, ...sharedPageIssues])
      ).slice(0, limit);
    }

    const pages = await searchSharedPages(credentials, searchTerm, limit);
    return pages.map((page) => toIssue(page));
  }

  if (searchTerm) {
    const issuesBySource = await Promise.all(
      credentials.scope.dataSourceIds.map((dataSourceId) =>
        searchDataSourceIssues(credentials.token, dataSourceId, searchTerm, limit)
      )
    );
    return sortByUpdatedAtDesc(dedupeIssuesByIdentifier(issuesBySource.flat())).slice(0, limit);
  }

  const pagesBySource = await Promise.all(
    credentials.scope.dataSourceIds.map((dataSourceId) =>
      queryDataSourcePages(credentials.token, dataSourceId, limit)
    )
  );
  const issues = pagesBySource.flat().map((page) => toIssue(page));
  return sortByUpdatedAtDesc(dedupeIssuesByIdentifier(issues)).slice(0, limit);
}

async function listIssues(opts: IssueQueryOpts): Promise<IssueListResult> {
  const credentials = await notionConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Notion is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(opts.limit, 50, 200);

  try {
    const issues = await listScopedIssues(credentials, undefined, sanitizedLimit);
    return { success: true, issues: sortByUpdatedAtDesc(issues) };
  } catch (error) {
    return toIssueListError(error, 'Failed to fetch Notion pages.');
  }
}

async function searchIssues(opts: IssueSearchOpts): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  const credentials = await notionConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Notion is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(opts.limit, 20, 200);

  try {
    const issues = await listScopedIssues(credentials, term, sanitizedLimit);
    return { success: true, issues: sortByUpdatedAtDesc(issues) };
  } catch (error) {
    return toIssueListError(error, 'Failed to search Notion pages.');
  }
}

function getBlockText(block: NotionBlock): string | undefined {
  const value = block[block.type];
  if (!value || typeof value !== 'object') return undefined;

  const richText = (value as { rich_text?: NotionRichText[] }).rich_text;
  const text = plainText(richText);
  if (!text) return undefined;

  if (block.type === 'to_do') {
    const checked = (value as { checked?: boolean }).checked;
    return `- [${checked ? 'x' : ' '}] ${text}`;
  }
  if (block.type === 'bulleted_list_item') return `- ${text}`;
  if (block.type === 'numbered_list_item') return `1. ${text}`;
  if (block.type === 'heading_1') return `# ${text}`;
  if (block.type === 'heading_2') return `## ${text}`;
  if (block.type === 'heading_3') return `### ${text}`;
  return text;
}

function blockChildrenPath(blockId: string, startCursor?: string): string {
  const params = new URLSearchParams({ page_size: String(BLOCK_CONTEXT_PAGE_SIZE) });
  if (startCursor) params.set('start_cursor', startCursor);
  return `/blocks/${encodeURIComponent(blockId)}/children?${params.toString()}`;
}

async function collectBlockLines(
  token: string,
  blockId: string,
  depth: number,
  remainingBlocks: { count: number }
): Promise<string[]> {
  const lines: string[] = [];
  let startCursor: string | undefined;

  do {
    const data = await notionConnectionService.request<NotionBlockChildrenResponse>(
      token,
      blockChildrenPath(blockId, startCursor)
    );

    for (const block of data.results) {
      if (remainingBlocks.count <= 0) return lines;
      remainingBlocks.count -= 1;

      const text = getBlockText(block);
      if (text) lines.push(text);

      if (block.has_children && depth < MAX_CONTEXT_DEPTH && remainingBlocks.count > 0) {
        lines.push(...(await collectBlockLines(token, block.id, depth + 1, remainingBlocks)));
      }
    }

    startCursor = data.next_cursor ?? undefined;
  } while (startCursor && remainingBlocks.count > 0);

  return lines;
}

async function fetchBlockContext(token: string, pageId: string): Promise<string | undefined> {
  const lines = await collectBlockLines(token, pageId, 0, { count: MAX_CONTEXT_BLOCKS });
  return lines.length ? lines.join('\n\n') : undefined;
}

async function getIssueContext(opts: IssueContextOpts): Promise<IssueContextResult> {
  const credentials = await notionConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Notion is not connected.' };
  }

  try {
    const page = await notionConnectionService.request<NotionPage>(
      credentials.token,
      `/pages/${encodeURIComponent(opts.identifier)}`
    );
    const context = await fetchBlockContext(credentials.token, page.id).catch(() => undefined);
    return { success: true, issue: toIssue(page, context) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch Notion page context.',
    };
  }
}

export const notionIssueProvider: IssueProvider = {
  type: 'notion',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.notion,
  isConfigured: () => notionConnectionService.isConfigured(),
  checkConnection: () => notionConnectionService.checkConnection(),
  listIssues,
  searchIssues,
  getIssueContext,
};

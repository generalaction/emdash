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
import { notionConnectionService, type NotionCredentials } from './notion-connection-service';

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
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string | null;
};

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

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

function getParentDatabaseId(page: NotionPage): string | undefined {
  return page.parent?.database_id ?? page.parent?.data_source_id;
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

function isInConfiguredDatabase(page: NotionPage, databaseIds: string[]): boolean {
  if (!databaseIds.length) return true;
  const parentId = getParentDatabaseId(page)?.replace(/-/g, '').toLowerCase();
  return !!parentId && databaseIds.includes(parentId);
}

function sortByUpdatedAtDesc(issues: LinkedIssue[]): LinkedIssue[] {
  return [...issues].sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}

async function searchPages(
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

    pages.push(
      ...data.results.filter((page) => isInConfiguredDatabase(page, credentials.databaseIds))
    );
    startCursor = data.next_cursor ?? undefined;
  } while (startCursor && pages.length < limit);

  return pages.slice(0, limit);
}

async function listIssues(opts: IssueQueryOpts): Promise<IssueListResult> {
  const credentials = await notionConnectionService.getStoredCredentials();
  if (!credentials) {
    return { success: false, error: 'Notion is not connected.' };
  }

  const sanitizedLimit = clampIssueLimit(opts.limit, 50, 200);

  try {
    const pages = await searchPages(credentials, undefined, sanitizedLimit);
    return { success: true, issues: sortByUpdatedAtDesc(pages.map((page) => toIssue(page))) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch Notion pages.',
    };
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
    const pages = await searchPages(credentials, term, sanitizedLimit);
    return { success: true, issues: sortByUpdatedAtDesc(pages.map((page) => toIssue(page))) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search Notion pages.',
    };
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

async function fetchBlockContext(token: string, pageId: string): Promise<string | undefined> {
  const data = await notionConnectionService.request<{ results: NotionBlock[] }>(
    token,
    `/blocks/${encodeURIComponent(pageId)}/children?page_size=50`
  );
  const lines = data.results.map(getBlockText).filter(Boolean) as string[];
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

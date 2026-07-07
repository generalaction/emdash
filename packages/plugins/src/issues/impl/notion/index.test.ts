import { noopLogger } from '@emdash/shared/logger';
import type { PageObjectResponse } from '@notionhq/client';
import type * as NotionSdk from '@notionhq/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provider } from './index';

const notionSdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@notionhq/client', async (importOriginal) => {
  const actual = await importOriginal<typeof NotionSdk>();
  return {
    ...actual,
    Client: class {
      constructor(config: unknown) {
        notionSdk.constructor(config);
      }

      search = notionSdk.search;
    },
  };
});

const issues = provider.behavior.issues;
if (!issues) throw new Error('Notion issues behavior is not registered');

const host = { log: noopLogger, credentials: { apiToken: 'ntn_valid' } };

function notionPage(
  id: string,
  title: string,
  parentType: 'database_id' | 'data_source_id' | 'page_id' | 'workspace' = 'database_id'
): PageObjectResponse {
  const parent =
    parentType === 'workspace'
      ? { type: 'workspace' as const, workspace: true }
      : { type: parentType, [parentType]: `${parentType}-1` };

  return {
    object: 'page',
    id,
    created_time: '2026-01-01T00:00:00.000Z',
    last_edited_time: '2026-01-02T00:00:00.000Z',
    created_by: { object: 'user', id: 'user-1' },
    last_edited_by: { object: 'user', id: 'user-1' },
    cover: null,
    icon: null,
    parent,
    archived: false,
    in_trash: false,
    is_locked: false,
    properties: {
      Name: {
        id: 'title',
        type: 'title',
        title: title
          ? [
              {
                type: 'text',
                plain_text: title,
                href: null,
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: 'default',
                },
                text: { content: title, link: null },
              },
            ]
          : [],
      },
    },
    url: `https://www.notion.so/${id}`,
    public_url: null,
    request_id: 'request-1',
  } as unknown as PageObjectResponse;
}

describe('notion issues plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists only titled database pages by default', async () => {
    notionSdk.search.mockResolvedValueOnce({
      object: 'list',
      results: [
        notionPage('task-page', 'Implement onboarding', 'database_id'),
        notionPage('plain-page', 'Team notes', 'page_id'),
        notionPage('untitled-page', '', 'database_id'),
      ],
      next_cursor: null,
      has_more: false,
      type: 'page_or_database',
      page_or_database: {},
    });

    const result = await issues.listIssues(host, { limit: 50 });

    expect(notionSdk.search).toHaveBeenCalledWith({
      filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' },
      page_size: 50,
    });
    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'task-page', title: 'Implement onboarding' })],
    });
  });

  it('keeps explicit search broad but filters untitled pages', async () => {
    notionSdk.search.mockResolvedValueOnce({
      object: 'list',
      results: [notionPage('plain-page', 'Team notes', 'page_id'), notionPage('untitled-page', '')],
      next_cursor: null,
      has_more: false,
      type: 'page_or_database',
      page_or_database: {},
    });

    const result = await issues.searchIssues(host, { searchTerm: 'team', limit: 20 });

    expect(notionSdk.search).toHaveBeenCalledWith({
      query: 'team',
      filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' },
      page_size: 20,
    });
    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'plain-page', title: 'Team notes' })],
    });
  });
});

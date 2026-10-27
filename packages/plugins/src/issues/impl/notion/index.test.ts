import { noopLogger } from '@emdash/shared/logger';
import type { PageObjectResponse } from '@notionhq/client';
import type * as NotionSdk from '@notionhq/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provider } from './index';

const notionSdk = vi.hoisted(() => ({
  blocksChildrenList: vi.fn(),
  pagesRetrieve: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@notionhq/client', async (importOriginal) => {
  const actual = await importOriginal<typeof NotionSdk>();
  return {
    ...actual,
    Client: class {
      blocks = { children: { list: notionSdk.blocksChildrenList } };
      pages = { retrieve: notionSdk.pagesRetrieve };
      search = notionSdk.search;
    },
  };
});

const issues = provider.behavior.issues;
if (!issues) throw new Error('Notion issues behavior is not registered');
if (!issues.getIssue) throw new Error('Notion getIssue behavior is not registered');
const getIssue = issues.getIssue;

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

function richText(text: string) {
  return [
    {
      type: 'text',
      plain_text: text,
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
      },
      text: { content: text, link: null },
    },
  ];
}

function paragraphBlock(id: string, text: string) {
  return {
    object: 'block',
    id,
    type: 'paragraph',
    paragraph: { rich_text: richText(text), color: 'default' },
  };
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
      page_size: 100,
    });
    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'task-page', title: 'Implement onboarding' })],
    });
  });

  it('continues listing until enough database pages survive filtering', async () => {
    notionSdk.search
      .mockResolvedValueOnce({
        object: 'list',
        results: [
          notionPage('plain-page', 'Team notes', 'page_id'),
          notionPage('untitled-page', ''),
        ],
        next_cursor: 'next-page',
        has_more: true,
        type: 'page_or_database',
        page_or_database: {},
      })
      .mockResolvedValueOnce({
        object: 'list',
        results: [notionPage('task-page', 'Implement onboarding', 'database_id')],
        next_cursor: null,
        has_more: false,
        type: 'page_or_database',
        page_or_database: {},
      });

    const result = await issues.listIssues(host, { limit: 1 });

    expect(notionSdk.search).toHaveBeenNthCalledWith(2, {
      filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' },
      page_size: 100,
      start_cursor: 'next-page',
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

  it('reads every block page when getting issue context', async () => {
    notionSdk.pagesRetrieve.mockResolvedValueOnce(notionPage('task-page', 'Implement onboarding'));
    notionSdk.blocksChildrenList
      .mockResolvedValueOnce({
        object: 'list',
        results: [paragraphBlock('block-1', 'First requirement')],
        next_cursor: 'next-blocks',
        has_more: true,
        type: 'block',
        block: {},
      })
      .mockResolvedValueOnce({
        object: 'list',
        results: [paragraphBlock('block-2', 'Later requirement')],
        next_cursor: null,
        has_more: false,
        type: 'block',
        block: {},
      });

    const result = await getIssue(host, { identifier: 'task-page' });

    expect(notionSdk.blocksChildrenList).toHaveBeenNthCalledWith(1, {
      block_id: 'task-page',
      page_size: 100,
    });
    expect(notionSdk.blocksChildrenList).toHaveBeenNthCalledWith(2, {
      block_id: 'task-page',
      page_size: 100,
      start_cursor: 'next-blocks',
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        identifier: 'task-page',
        context: 'First requirement\nLater requirement',
      }),
    });
  });

  it('skips partial blocks while formatting issue context', async () => {
    notionSdk.pagesRetrieve.mockResolvedValueOnce(notionPage('task-page', 'Implement onboarding'));
    notionSdk.blocksChildrenList.mockResolvedValueOnce({
      object: 'list',
      results: [
        { object: 'block', id: 'partial-paragraph', type: 'paragraph' },
        paragraphBlock('block-1', 'Accessible requirement'),
      ],
      next_cursor: null,
      has_more: false,
      type: 'block',
      block: {},
    });

    const result = await getIssue(host, { identifier: 'task-page' });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ context: 'Accessible requirement' }),
    });
  });
});

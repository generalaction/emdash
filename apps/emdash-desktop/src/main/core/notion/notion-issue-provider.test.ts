import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notionConnectionService } from './notion-connection-service';
import { notionIssueProvider } from './notion-issue-provider';

vi.mock('./notion-connection-service', () => ({
  notionConnectionService: {
    getStoredCredentials: vi.fn(),
    isConfigured: vi.fn(),
    checkConnection: vi.fn(),
    request: vi.fn(),
  },
}));

const mockGetStoredCredentials = vi.mocked(notionConnectionService.getStoredCredentials);
const mockRequest = vi.mocked(notionConnectionService.request);

const DATA_SOURCE_ID = 'abcdefabcdefabcdefabcdefabcdefab';
const PAGE = {
  object: 'page',
  id: 'page-1',
  url: 'https://www.notion.so/acme/Fix-login-bug-page-1',
  parent: { type: 'data_source_id', data_source_id: DATA_SOURCE_ID },
  last_edited_time: '2026-05-20T10:00:00.000Z',
  properties: {
    Name: { type: 'title', title: [{ plain_text: 'Fix login bug' }] },
    Description: { type: 'rich_text', rich_text: [{ plain_text: 'Steps to reproduce...' }] },
    Status: { type: 'status', status: { name: 'In progress' } },
    Assignee: { type: 'people', people: [{ name: 'Jan' }] },
  },
} as const;

describe('notionIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listIssues', () => {
    it('queries configured data sources directly', async () => {
      const credentials = {
        token: 'tok',
        scope: { type: 'data-sources' as const, dataSourceIds: [DATA_SOURCE_ID], sourceUrls: [] },
      };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockResolvedValue({
        results: [PAGE],
        has_more: false,
        next_cursor: null,
      });

      const result = await notionIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({
        success: true,
        issues: [
          expect.objectContaining({
            provider: 'notion',
            identifier: PAGE.id,
            title: 'Fix login bug',
            url: PAGE.url,
            description: 'Steps to reproduce...',
            status: 'In progress',
            assignees: ['Jan'],
          }),
        ],
      });
      expect(mockRequest).toHaveBeenCalledWith(
        credentials.token,
        `/data_sources/${DATA_SOURCE_ID}/query`,
        expect.objectContaining({
          method: 'POST',
          body: expect.not.stringContaining('result_type'),
        })
      );
    });

    it('discovers shared data sources when no data source scope is configured', async () => {
      const credentials = { token: 'tok', scope: { type: 'all-shared' as const } };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest
        .mockResolvedValueOnce({
          results: [
            {
              object: 'data_source',
              id: DATA_SOURCE_ID,
              url: 'https://app.notion.com/p/source',
              title: [{ plain_text: 'Goals' }],
            },
          ],
          has_more: false,
          next_cursor: null,
        })
        .mockResolvedValueOnce({
          results: [PAGE],
          has_more: false,
          next_cursor: null,
        });

      const result = await notionIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({
        success: true,
        issues: [expect.objectContaining({ title: 'Fix login bug' })],
      });
      expect(mockRequest).toHaveBeenCalledWith(
        credentials.token,
        '/search',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"value":"data_source"'),
        })
      );
      expect(mockRequest).toHaveBeenCalledWith(
        credentials.token,
        `/data_sources/${DATA_SOURCE_ID}/query`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('merges shared pages with discovered data source pages', async () => {
      const credentials = { token: 'tok', scope: { type: 'all-shared' as const } };
      const sharedPage = {
        ...PAGE,
        id: 'shared-page-1',
        parent: { type: 'page_id' },
        properties: {
          ...PAGE.properties,
          Name: { type: 'title', title: [{ plain_text: 'Standalone plan' }] },
        },
      };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest
        .mockResolvedValueOnce({
          results: [
            { object: 'data_source', id: DATA_SOURCE_ID, url: 'https://app.notion.com/p/source' },
          ],
          has_more: false,
          next_cursor: null,
        })
        .mockResolvedValueOnce({
          results: [PAGE],
          has_more: false,
          next_cursor: null,
        })
        .mockResolvedValueOnce({
          results: [sharedPage],
          has_more: false,
          next_cursor: null,
        });

      const result = await notionIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({
        success: true,
        issues: [
          expect.objectContaining({ title: 'Fix login bug' }),
          expect.objectContaining({ title: 'Standalone plan' }),
        ],
      });
      expect(mockRequest).toHaveBeenLastCalledWith(
        credentials.token,
        '/search',
        expect.objectContaining({ body: expect.stringContaining('"value":"page"') })
      );
    });

    it('returns error when no credentials stored', async () => {
      mockGetStoredCredentials.mockResolvedValue(null);

      const result = await notionIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: false, error: 'Notion is not connected.' });
    });
  });

  describe('searchIssues', () => {
    it('returns no results for an empty search term without querying Notion', async () => {
      const result = await notionIssueProvider.searchIssues({ searchTerm: '   ', limit: 20 });

      expect(result).toEqual({ success: true, issues: [] });
      expect(mockGetStoredCredentials).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('passes the search query to Notion', async () => {
      const credentials = { token: 'tok', scope: { type: 'all-shared' as const } };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockResolvedValue({
        results: [PAGE],
        has_more: false,
        next_cursor: null,
      });

      const result = await notionIssueProvider.searchIssues({ searchTerm: 'login', limit: 20 });

      expect(result).toEqual({ success: true, issues: [expect.any(Object)] });
      expect(mockRequest).toHaveBeenCalledWith(
        credentials.token,
        '/search',
        expect.objectContaining({ body: expect.stringContaining('"query":"login"') })
      );
    });

    it('searches configured data sources without global parent filtering', async () => {
      const credentials = {
        token: 'tok',
        scope: { type: 'data-sources' as const, dataSourceIds: [DATA_SOURCE_ID], sourceUrls: [] },
      };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockResolvedValue({
        results: [
          PAGE,
          {
            ...PAGE,
            id: 'page-2',
            properties: {
              ...PAGE.properties,
              Name: { type: 'title', title: [{ plain_text: 'Write release notes' }] },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });

      const result = await notionIssueProvider.searchIssues({ searchTerm: 'login', limit: 20 });

      expect(result).toEqual({
        success: true,
        issues: [expect.objectContaining({ identifier: PAGE.id })],
      });
      expect(mockRequest).toHaveBeenCalledWith(
        credentials.token,
        `/data_sources/${DATA_SOURCE_ID}/query`,
        expect.objectContaining({ method: 'POST' })
      );
      expect(mockRequest).not.toHaveBeenCalledWith(credentials.token, '/search', expect.anything());
    });

    it('continues paginating configured data source search until it finds matches', async () => {
      const credentials = {
        token: 'tok',
        scope: { type: 'data-sources' as const, dataSourceIds: [DATA_SOURCE_ID], sourceUrls: [] },
      };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest
        .mockResolvedValueOnce({
          results: [
            {
              ...PAGE,
              id: 'page-2',
              properties: {
                ...PAGE.properties,
                Name: { type: 'title', title: [{ plain_text: 'Write release notes' }] },
              },
            },
          ],
          has_more: true,
          next_cursor: 'cursor-2',
        })
        .mockResolvedValueOnce({
          results: [PAGE],
          has_more: false,
          next_cursor: null,
        });

      const result = await notionIssueProvider.searchIssues({ searchTerm: 'login', limit: 20 });

      expect(result).toEqual({
        success: true,
        issues: [expect.objectContaining({ identifier: PAGE.id })],
      });
      expect(mockRequest).toHaveBeenLastCalledWith(
        credentials.token,
        `/data_sources/${DATA_SOURCE_ID}/query`,
        expect.objectContaining({ body: expect.stringContaining('"start_cursor":"cursor-2"') })
      );
    });
  });

  describe('getIssueContext', () => {
    it('returns page metadata with block children as context', async () => {
      const credentials = { token: 'tok', scope: { type: 'all-shared' as const } };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockResolvedValueOnce(PAGE).mockResolvedValueOnce({
        results: [
          { id: 'block-1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Body' }] } },
          {
            id: 'block-2',
            type: 'to_do',
            to_do: { checked: true, rich_text: [{ plain_text: 'Verified locally' }] },
          },
        ],
      });

      const result = await notionIssueProvider.getIssueContext!({ identifier: PAGE.id });

      expect(result).toEqual({
        success: true,
        issue: expect.objectContaining({
          provider: 'notion',
          identifier: PAGE.id,
          title: 'Fix login bug',
          context: expect.stringContaining('Body'),
        }),
      });
      if (result.success) {
        expect(result.issue.context).toContain('- [x] Verified locally');
      }
      expect(mockRequest).toHaveBeenCalledWith(credentials.token, `/pages/${PAGE.id}`);
      expect(mockRequest).toHaveBeenCalledWith(
        credentials.token,
        `/blocks/${PAGE.id}/children?page_size=100`
      );
    });

    it('follows block children pagination when building context', async () => {
      const credentials = { token: 'tok', scope: { type: 'all-shared' as const } };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest
        .mockResolvedValueOnce(PAGE)
        .mockResolvedValueOnce({
          results: [
            {
              id: 'block-1',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'First page body' }] },
            },
          ],
          has_more: true,
          next_cursor: 'cursor-2',
        })
        .mockResolvedValueOnce({
          results: [
            {
              id: 'block-2',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'Second page body' }] },
            },
          ],
          has_more: false,
          next_cursor: null,
        });

      const result = await notionIssueProvider.getIssueContext!({ identifier: PAGE.id });

      expect(result).toEqual({
        success: true,
        issue: expect.objectContaining({
          context: expect.stringContaining('First page body'),
        }),
      });
      if (result.success) {
        expect(result.issue.context).toContain('Second page body');
      }
      expect(mockRequest).toHaveBeenCalledWith(
        credentials.token,
        `/blocks/${PAGE.id}/children?page_size=100&start_cursor=cursor-2`
      );
    });

    it('includes nested child blocks when building context', async () => {
      const credentials = { token: 'tok', scope: { type: 'all-shared' as const } };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest
        .mockResolvedValueOnce(PAGE)
        .mockResolvedValueOnce({
          results: [
            {
              id: 'block-parent',
              type: 'toggle',
              has_children: true,
              toggle: { rich_text: [{ plain_text: 'Investigation notes' }] },
            },
          ],
          has_more: false,
          next_cursor: null,
        })
        .mockResolvedValueOnce({
          results: [
            {
              id: 'block-child',
              type: 'paragraph',
              paragraph: { rich_text: [{ plain_text: 'Nested reproduction detail' }] },
            },
          ],
          has_more: false,
          next_cursor: null,
        });

      const result = await notionIssueProvider.getIssueContext!({ identifier: PAGE.id });

      expect(result).toEqual({
        success: true,
        issue: expect.objectContaining({
          context: expect.stringContaining('Investigation notes'),
        }),
      });
      if (result.success) {
        expect(result.issue.context).toContain('Nested reproduction detail');
      }
      expect(mockRequest).toHaveBeenCalledWith(
        credentials.token,
        '/blocks/block-parent/children?page_size=100'
      );
    });
  });
});

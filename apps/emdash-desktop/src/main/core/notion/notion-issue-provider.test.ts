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

const DATABASE_ID = 'abcdefabcdefabcdefabcdefabcdefab';
const PAGE = {
  object: 'page',
  id: 'page-1',
  url: 'https://www.notion.so/acme/Fix-login-bug-page-1',
  parent: { type: 'database_id', database_id: DATABASE_ID },
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
    it('returns pages from configured databases', async () => {
      const credentials = { token: 'tok', databaseIds: [DATABASE_ID], databaseUrls: [] };
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
        '/search',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"value":"page"'),
        })
      );
    });

    it('filters out pages outside configured database scope', async () => {
      const credentials = {
        token: 'tok',
        databaseIds: ['11111111111111111111111111111111'],
        databaseUrls: [],
      };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockResolvedValue({
        results: [PAGE],
        has_more: false,
        next_cursor: null,
      });

      const result = await notionIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: true, issues: [] });
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
      const credentials = { token: 'tok', databaseIds: [], databaseUrls: [] };
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
  });

  describe('getIssueContext', () => {
    it('returns page metadata with block children as context', async () => {
      const credentials = { token: 'tok', databaseIds: [], databaseUrls: [] };
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
        `/blocks/${PAGE.id}/children?page_size=50`
      );
    });
  });
});

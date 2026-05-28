import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mondayConnectionService } from './monday-connection-service';
import { mondayIssueProvider } from './monday-issue-provider';

vi.mock('./monday-connection-service', () => ({
  mondayConnectionService: {
    getStoredCredentials: vi.fn(),
    checkConnection: vi.fn(),
    query: vi.fn(),
  },
}));

const mockGetStoredCredentials = vi.mocked(mondayConnectionService.getStoredCredentials);
const mockQuery = vi.mocked(mondayConnectionService.query);

describe('mondayIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listIssues', () => {
    it('returns items from configured boards', async () => {
      const credentials = { token: 'tok', boardIds: ['111'] };
      const item = {
        id: '101',
        name: 'Fix login bug',
        updated_at: '2026-05-20T10:00:00Z',
        group: { title: 'In Progress' },
        column_values: [
          { id: 'status', type: 'status', text: 'Working on it' },
          { id: 'person', type: 'people', text: 'Snir' },
        ],
      };
      const board = {
        id: '111',
        name: 'Sprint Board',
        url: 'https://myteam.monday.com/boards/111',
        items_page: { items: [item] },
      };

      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockQuery.mockResolvedValue({ boards: [board] });

      const result = await mondayIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({
        success: true,
        issues: [
          expect.objectContaining({
            provider: 'monday',
            identifier: item.id,
            title: item.name,
            url: `${board.url}/pulses/${item.id}`,
          }),
        ],
      });
    });

    it('returns error when no credentials stored', async () => {
      mockGetStoredCredentials.mockResolvedValue(null);

      const result = await mondayIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: false, error: 'Monday.com is not connected.' });
    });

    it('returns error when API query fails', async () => {
      const credentials = { token: 'tok', boardIds: ['111'] };
      const apiError = new Error('Rate limit exceeded');

      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockQuery.mockRejectedValue(apiError);

      const result = await mondayIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: false, error: apiError.message });
    });
  });

  describe('searchIssues', () => {
    it('filters items by search term', async () => {
      const credentials = { token: 'tok', boardIds: ['111'] };
      const item = {
        id: '202',
        name: 'Search feature',
        updated_at: '2026-05-21T10:00:00Z',
        group: { title: 'Done' },
        column_values: [{ id: 'status', type: 'status', text: 'Done' }],
      };
      const board = {
        id: '111',
        name: 'Sprint Board',
        url: 'https://myteam.monday.com/boards/111',
        items_page: { items: [item] },
      };

      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockQuery.mockResolvedValue({ boards: [board] });

      const result = await mondayIssueProvider.searchIssues({
        searchTerm: 'search',
        limit: 20,
      });

      expect(result).toEqual({
        success: true,
        issues: [
          expect.objectContaining({
            provider: 'monday',
            identifier: item.id,
            title: item.name,
          }),
        ],
      });
    });

    it('returns error when no credentials stored', async () => {
      mockGetStoredCredentials.mockResolvedValue(null);

      const result = await mondayIssueProvider.searchIssues({
        searchTerm: 'test',
        limit: 20,
      });

      expect(result).toEqual({ success: false, error: 'Monday.com is not connected.' });
    });
  });

  describe('getIssueContext', () => {
    it('returns item with updates as context', async () => {
      const credentials = { token: 'tok', boardIds: ['111'] };
      const update = {
        id: 'upd-1',
        text_body: 'Started investigating the auth flow.',
        created_at: '2026-05-19T09:00:00Z',
        creator: { name: 'Snir' },
      };
      const item = {
        id: '101',
        name: 'Fix login bug',
        updated_at: '2026-05-20T10:00:00Z',
        board: {
          id: '111',
          name: 'Sprint Board',
          url: 'https://myteam.monday.com/boards/111',
        },
        group: { title: 'In Progress' },
        column_values: [{ id: 'status', type: 'status', text: 'Working on it' }],
        updates: [update],
      };

      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockQuery.mockResolvedValue({ items: [item] });

      const result = await mondayIssueProvider.getIssueContext!({
        identifier: item.id,
      });

      expect(result).toEqual({
        success: true,
        issue: expect.objectContaining({
          provider: 'monday',
          identifier: item.id,
          title: item.name,
          context: expect.stringContaining(update.text_body),
        }),
      });
    });

    it('returns item description from Monday Doc', async () => {
      const credentials = { token: 'tok', boardIds: ['111'] };
      const docValue = JSON.stringify({
        files: [{ fileType: 'MONDAY_DOC_ITEM_DESCRIPTION', objectId: 42034047 }],
      });
      const item = {
        id: '101',
        name: 'Fix login bug',
        updated_at: '2026-05-20T10:00:00Z',
        board: {
          id: '111',
          name: 'Sprint Board',
          url: 'https://myteam.monday.com/boards/111',
        },
        group: { title: 'In Progress' },
        column_values: [
          { id: 'monday_doc_v2', type: 'direct_doc', text: '', value: docValue },
        ],
        updates: [],
      };

      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockQuery
        .mockResolvedValueOnce({ items: [item] })
        .mockResolvedValueOnce({ export_markdown_from_doc: { markdown: 'Doc description content' } });

      const result = await mondayIssueProvider.getIssueContext!({
        identifier: item.id,
      });

      expect(result).toEqual({
        success: true,
        issue: expect.objectContaining({
          provider: 'monday',
          identifier: item.id,
          description: 'Doc description content',
        }),
      });
      expect(mockQuery).toHaveBeenCalledWith(
        credentials.token,
        expect.stringContaining('export_markdown_from_doc'),
        { docId: '42034047' }
      );
    });

    it('returns error when item not found', async () => {
      const credentials = { token: 'tok', boardIds: ['111'] };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockQuery.mockResolvedValue({ items: [] });

      const result = await mondayIssueProvider.getIssueContext!({
        identifier: '999',
      });

      expect(result).toEqual({ success: false, error: 'Item 999 not found.' });
    });

    it('returns error when no credentials stored', async () => {
      mockGetStoredCredentials.mockResolvedValue(null);

      const result = await mondayIssueProvider.getIssueContext!({
        identifier: '101',
      });

      expect(result).toEqual({ success: false, error: 'Monday.com is not connected.' });
    });
  });
});

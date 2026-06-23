import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trelloConnectionService } from './trello-connection-service';
import { trelloIssueProvider } from './trello-issue-provider';

vi.mock('./trello-connection-service', () => ({
  trelloConnectionService: {
    getStoredCredentials: vi.fn(),
    checkConnection: vi.fn(),
    request: vi.fn(),
  },
}));

const mockGetStoredCredentials = vi.mocked(trelloConnectionService.getStoredCredentials);
const mockRequest = vi.mocked(trelloConnectionService.request);

const CARD = {
  id: 'card-1',
  name: 'Fix login bug',
  desc: 'Steps to reproduce...',
  url: 'https://trello.com/c/aBcD1234/1-fix-login-bug',
  shortLink: 'aBcD1234',
  dateLastActivity: '2026-05-20T10:00:00.000Z',
};

describe('trelloIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listIssues', () => {
    it('returns cards from configured boards', async () => {
      const credentials = { apiKey: 'key', token: 'tok', boardIds: ['board-1'] };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest
        .mockResolvedValueOnce({ id: 'board-1', name: 'Sprint Board' })
        .mockResolvedValueOnce([CARD]);

      const result = await trelloIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({
        success: true,
        issues: [
          expect.objectContaining({
            provider: 'trello',
            identifier: CARD.shortLink,
            title: CARD.name,
            url: CARD.url,
            description: CARD.desc,
            project: 'Sprint Board',
          }),
        ],
      });
      expect(mockRequest).toHaveBeenCalledWith(credentials, '/boards/board-1', {
        fields: 'name',
      });
      expect(mockRequest).toHaveBeenCalledWith(
        credentials,
        '/boards/board-1/cards/open',
        expect.objectContaining({ fields: expect.stringContaining('shortLink') })
      );
    });

    it('falls back to the member boards when no boards are configured', async () => {
      const credentials = { apiKey: 'key', token: 'tok', boardIds: [] };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest
        .mockResolvedValueOnce([
          { id: 'board-1', name: 'Sprint Board', closed: false },
          { id: 'board-2', name: 'Old Board', closed: true },
        ])
        .mockResolvedValueOnce([CARD]);

      const result = await trelloIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: true, issues: [expect.any(Object)] });
      expect(mockRequest).toHaveBeenCalledWith(
        credentials,
        '/members/me/boards',
        expect.objectContaining({ filter: 'open' })
      );
      expect(mockRequest).not.toHaveBeenCalledWith(
        credentials,
        '/boards/board-2/cards/open',
        expect.anything()
      );
    });

    it('sorts cards by last activity descending', async () => {
      const credentials = { apiKey: 'key', token: 'tok', boardIds: ['board-1'] };
      const older = { ...CARD, shortLink: 'older123', dateLastActivity: '2026-05-01T10:00:00Z' };
      const newer = { ...CARD, shortLink: 'newer123', dateLastActivity: '2026-05-25T10:00:00Z' };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest
        .mockResolvedValueOnce({ id: 'board-1', name: 'Sprint Board' })
        .mockResolvedValueOnce([older, newer]);

      const result = await trelloIssueProvider.listIssues({ limit: 50 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.issues.map((issue) => issue.identifier)).toEqual(['newer123', 'older123']);
      }
    });

    it('returns error when no credentials stored', async () => {
      mockGetStoredCredentials.mockResolvedValue(null);

      const result = await trelloIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: false, error: 'Trello is not connected.' });
    });

    it('returns error when API request fails', async () => {
      const credentials = { apiKey: 'key', token: 'tok', boardIds: ['board-1'] };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockRejectedValue(new Error('Rate limit exceeded'));

      const result = await trelloIssueProvider.listIssues({ limit: 50 });

      expect(result).toEqual({ success: false, error: 'Rate limit exceeded' });
    });
  });

  describe('searchIssues', () => {
    it('returns no results for an empty search term without querying Trello', async () => {
      const result = await trelloIssueProvider.searchIssues({ searchTerm: '   ', limit: 20 });

      expect(result).toEqual({ success: true, issues: [] });
      expect(mockGetStoredCredentials).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('searches cards and scopes the search to configured boards', async () => {
      const credentials = { apiKey: 'key', token: 'tok', boardIds: ['board-1', 'board-2'] };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockResolvedValue({ cards: [{ ...CARD, board: { name: 'Sprint Board' } }] });

      const result = await trelloIssueProvider.searchIssues({ searchTerm: 'login', limit: 20 });

      expect(result).toEqual({
        success: true,
        issues: [
          expect.objectContaining({
            provider: 'trello',
            identifier: CARD.shortLink,
            title: CARD.name,
            project: 'Sprint Board',
          }),
        ],
      });
      expect(mockRequest).toHaveBeenCalledWith(
        credentials,
        '/search',
        expect.objectContaining({
          query: 'login',
          modelTypes: 'cards',
          idBoards: 'board-1,board-2',
        })
      );
    });

    it('omits the board scope when no boards are configured', async () => {
      const credentials = { apiKey: 'key', token: 'tok', boardIds: [] };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockResolvedValue({ cards: [] });

      await trelloIssueProvider.searchIssues({ searchTerm: 'login', limit: 20 });

      expect(mockRequest).toHaveBeenCalledWith(
        credentials,
        '/search',
        expect.not.objectContaining({ idBoards: expect.anything() })
      );
    });

    it('returns error when no credentials stored', async () => {
      mockGetStoredCredentials.mockResolvedValue(null);

      const result = await trelloIssueProvider.searchIssues({ searchTerm: 'test', limit: 20 });

      expect(result).toEqual({ success: false, error: 'Trello is not connected.' });
    });
  });

  describe('getIssueContext', () => {
    it('returns the card with comments and checklists as context', async () => {
      const credentials = { apiKey: 'key', token: 'tok', boardIds: [] };
      mockGetStoredCredentials.mockResolvedValue(credentials);
      mockRequest.mockResolvedValue({
        ...CARD,
        board: { name: 'Sprint Board' },
        actions: [
          {
            id: 'action-1',
            date: '2026-05-19T09:00:00.000Z',
            data: { text: 'Started investigating the auth flow.' },
            memberCreator: { fullName: 'Jan' },
          },
        ],
        checklists: [
          {
            id: 'checklist-1',
            name: 'Steps',
            checkItems: [
              { name: 'Reproduce locally', state: 'complete', pos: 1 },
              { name: 'Write regression test', state: 'incomplete', pos: 2 },
            ],
          },
        ],
      });

      const result = await trelloIssueProvider.getIssueContext!({ identifier: CARD.shortLink });

      expect(result).toEqual({
        success: true,
        issue: expect.objectContaining({
          provider: 'trello',
          identifier: CARD.shortLink,
          title: CARD.name,
          project: 'Sprint Board',
          context: expect.stringContaining('Started investigating the auth flow.'),
        }),
      });
      if (result.success) {
        expect(result.issue.context).toContain('- [x] Reproduce locally');
        expect(result.issue.context).toContain('- [ ] Write regression test');
      }
      expect(mockRequest).toHaveBeenCalledWith(
        credentials,
        `/cards/${CARD.shortLink}`,
        expect.objectContaining({ actions: 'commentCard', checklists: 'all' })
      );
    });

    it('returns error when no credentials stored', async () => {
      mockGetStoredCredentials.mockResolvedValue(null);

      const result = await trelloIssueProvider.getIssueContext!({ identifier: 'aBcD1234' });

      expect(result).toEqual({ success: false, error: 'Trello is not connected.' });
    });
  });
});

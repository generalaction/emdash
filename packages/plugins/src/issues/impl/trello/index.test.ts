import type { Logger } from '@emdash/shared/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { provider } from './index';

const logger: Logger = {
  level: 'error',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
};

const issues = provider.behavior.issues;
if (!issues?.getIssue) throw new Error('Trello issues behavior is not registered.');
const getIssue = issues.getIssue;

const CREDENTIALS = { apiKey: 'key', apiToken: 'tok', boardIds: ['board-1'] };

function host(
  credentials: ConnectedIntegrationHostContext['credentials']
): ConnectedIntegrationHostContext {
  return { log: logger, credentials };
}

const CARD = {
  id: 'card-1',
  name: 'Fix login bug',
  desc: 'Steps to reproduce...',
  url: 'https://trello.com/c/aBcD1234/1-fix-login-bug',
  shortLink: 'aBcD1234',
  dateLastActivity: '2026-05-20T10:00:00.000Z',
};

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/** Route responses by pathname since Trello calls can run concurrently. */
function routeFetch(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input: URL) => {
    const body = routes[input.pathname];
    if (body === undefined) throw new Error(`Unexpected request: ${input.pathname}`);
    return jsonResponse(body);
  });
}

function requestedUrls(): URL[] {
  return fetchMock.mock.calls.map((call) => call[0] as URL);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('trello issues plugin', () => {
  describe('listIssues', () => {
    it('returns cards from configured boards mapped to issues', async () => {
      routeFetch({
        '/1/boards/board-1': { id: 'board-1', name: 'Sprint Board' },
        '/1/boards/board-1/cards/open': [CARD],
      });

      const result = await issues.listIssues(host(CREDENTIALS), { limit: 50 });

      expect(result).toEqual({
        success: true,
        data: [
          expect.objectContaining({
            identifier: CARD.shortLink,
            title: CARD.name,
            url: CARD.url,
            description: CARD.desc,
            project: 'Sprint Board',
          }),
        ],
      });

      const cardsUrl = requestedUrls().find((url) =>
        url.pathname.endsWith('/boards/board-1/cards/open')
      );
      expect(cardsUrl).toBeDefined();
      expect(cardsUrl!.searchParams.get('fields')).toContain('shortLink');
      expect(cardsUrl!.searchParams.get('key')).toBe('key');
      expect(cardsUrl!.searchParams.get('token')).toBe('tok');
    });

    it('falls back to open member boards when no boards are configured', async () => {
      routeFetch({
        '/1/members/me/boards': [
          { id: 'board-1', name: 'Sprint Board', closed: false },
          { id: 'board-2', name: 'Old Board', closed: true },
        ],
        '/1/boards/board-1/cards/open': [CARD],
      });

      const result = await issues.listIssues(
        host({ apiKey: 'key', apiToken: 'tok', boardIds: [] }),
        { limit: 50 }
      );

      expect(result).toEqual({ success: true, data: [expect.any(Object)] });

      const urls = requestedUrls();
      const memberBoardsUrl = urls.find((url) => url.pathname.endsWith('/members/me/boards'));
      expect(memberBoardsUrl).toBeDefined();
      expect(memberBoardsUrl!.searchParams.get('filter')).toBe('open');
      expect(urls.some((url) => url.pathname.includes('/boards/board-2/cards'))).toBe(false);
    });

    it('sorts cards by last activity descending', async () => {
      const older = { ...CARD, shortLink: 'older123', dateLastActivity: '2026-05-01T10:00:00Z' };
      const newer = { ...CARD, shortLink: 'newer123', dateLastActivity: '2026-05-25T10:00:00Z' };
      routeFetch({
        '/1/boards/board-1': { id: 'board-1', name: 'Sprint Board' },
        '/1/boards/board-1/cards/open': [older, newer],
      });

      const result = await issues.listIssues(host(CREDENTIALS), { limit: 50 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.map((issue) => issue.identifier)).toEqual(['newer123', 'older123']);
      }
    });

    it('returns a generic error when an API request fails', async () => {
      fetchMock.mockRejectedValue(new Error('Rate limit exceeded'));

      const result = await issues.listIssues(host(CREDENTIALS), { limit: 50 });

      expect(result).toEqual({
        success: false,
        error: { type: 'generic', message: 'Rate limit exceeded' },
      });
    });

    it('throws when the host provides no credentials', async () => {
      await expect(issues.listIssues(host({}), { limit: 50 })).rejects.toThrow(
        'Trello API key and token cannot be empty.'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('searchIssues', () => {
    it('returns no results for an empty search term without querying Trello', async () => {
      const result = await issues.searchIssues(host(CREDENTIALS), {
        searchTerm: '   ',
        limit: 20,
      });

      expect(result).toEqual({ success: true, data: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('searches cards and scopes the search to configured boards', async () => {
      routeFetch({ '/1/search': { cards: [{ ...CARD, board: { name: 'Sprint Board' } }] } });

      const result = await issues.searchIssues(
        host({ apiKey: 'key', apiToken: 'tok', boardIds: ['board-1', 'board-2'] }),
        { searchTerm: 'login', limit: 20 }
      );

      expect(result).toEqual({
        success: true,
        data: [
          expect.objectContaining({
            identifier: CARD.shortLink,
            title: CARD.name,
            project: 'Sprint Board',
          }),
        ],
      });

      const searchUrl = requestedUrls()[0];
      expect(searchUrl.pathname).toBe('/1/search');
      expect(searchUrl.searchParams.get('query')).toBe('login');
      expect(searchUrl.searchParams.get('modelTypes')).toBe('cards');
      expect(searchUrl.searchParams.get('idBoards')).toBe('board-1,board-2');
    });

    it('omits the board scope when no boards are configured', async () => {
      routeFetch({ '/1/search': { cards: [] } });

      await issues.searchIssues(host({ apiKey: 'key', apiToken: 'tok', boardIds: [] }), {
        searchTerm: 'login',
        limit: 20,
      });

      expect(requestedUrls()[0].searchParams.has('idBoards')).toBe(false);
    });
  });

  describe('getIssue', () => {
    it('returns the card with comments and checklists as context', async () => {
      routeFetch({
        [`/1/cards/${CARD.shortLink}`]: {
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
        },
      });

      const result = await getIssue(host(CREDENTIALS), {
        identifier: CARD.shortLink,
      });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          identifier: CARD.shortLink,
          title: CARD.name,
          project: 'Sprint Board',
          context: expect.stringContaining('Started investigating the auth flow.'),
        }),
      });
      if (result.success) {
        expect(result.data.context).toContain('- [x] Reproduce locally');
        expect(result.data.context).toContain('- [ ] Write regression test');
      }

      const cardUrl = requestedUrls()[0];
      expect(cardUrl.searchParams.get('actions')).toBe('commentCard');
      expect(cardUrl.searchParams.get('checklists')).toBe('all');
    });
  });
});

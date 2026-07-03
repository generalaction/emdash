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
if (!issues?.getIssue) throw new Error('Monday issues behavior is not registered.');
const getIssue = issues.getIssue;

const CREDENTIALS = { apiToken: 'tok', boardIds: ['111'], boardUrls: [] };

function host(
  credentials: ConnectedIntegrationHostContext['credentials']
): ConnectedIntegrationHostContext {
  return { log: logger, credentials };
}

const fetchMock = vi.fn();

function graphqlResponse(data: unknown) {
  return { ok: true, json: async () => ({ data }) };
}

function requestBody(callIndex = 0): { query: string; variables: Record<string, unknown> } {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body as string);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const ITEM = {
  id: '101',
  name: 'Fix login bug',
  updated_at: '2026-05-20T10:00:00Z',
  group: { title: 'In Progress' },
  column_values: [
    { id: 'status', type: 'status', text: 'Working on it' },
    { id: 'person', type: 'people', text: 'Snir' },
  ],
};

const BOARD = {
  id: '111',
  name: 'Sprint Board',
  url: 'https://myteam.monday.com/boards/111',
  items_page: { items: [ITEM] },
};

describe('monday issues plugin', () => {
  describe('listIssues', () => {
    it('returns items from configured boards mapped to issues', async () => {
      fetchMock.mockResolvedValueOnce(graphqlResponse({ boards: [BOARD] }));

      const result = await issues.listIssues(host(CREDENTIALS), { limit: 50 });

      expect(result).toEqual({
        success: true,
        data: [
          expect.objectContaining({
            identifier: ITEM.id,
            title: ITEM.name,
            url: `${BOARD.url}/pulses/${ITEM.id}`,
          }),
        ],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.monday.com/v2',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'tok' }),
        })
      );
    });

    it('scopes the query to configured boards ordered by updated_at descending', async () => {
      fetchMock.mockResolvedValueOnce(graphqlResponse({ boards: [BOARD] }));

      await issues.listIssues(host(CREDENTIALS), { limit: 50 });

      const body = requestBody();
      expect(body.query).toContain('query_params');
      expect(body.variables).toEqual(
        expect.objectContaining({
          boardIds: ['111'],
          queryParams: {
            order_by: [{ column_id: '__last_updated__', direction: 'desc' }],
          },
        })
      );
    });

    it('queries the first 20 accessible boards when no boards are configured', async () => {
      fetchMock.mockResolvedValueOnce(graphqlResponse({ boards: [BOARD] }));

      await issues.listIssues(host({ apiToken: 'tok' }), { limit: 50 });

      const body = requestBody();
      expect(body.query).toContain('boards(limit: 20)');
      expect(body.variables).not.toHaveProperty('boardIds');
    });

    it('returns a generic error when the API query fails', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Rate limit exceeded'));

      const result = await issues.listIssues(host(CREDENTIALS), { limit: 50 });

      expect(result).toEqual({
        success: false,
        error: { type: 'generic', message: 'Rate limit exceeded' },
      });
    });

    it('throws when the host provides no API token', async () => {
      await expect(issues.listIssues(host({}), { limit: 50 })).rejects.toThrow(
        'Monday.com API token cannot be empty.'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('searchIssues', () => {
    it('returns no results for an empty search term without querying Monday', async () => {
      const result = await issues.searchIssues(host(CREDENTIALS), {
        searchTerm: '   ',
        limit: 20,
      });

      expect(result).toEqual({ success: true, data: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('filters items by search term and orders by updated_at descending', async () => {
      const item = { ...ITEM, id: '202', name: 'Search feature' };
      fetchMock.mockResolvedValueOnce(
        graphqlResponse({ boards: [{ ...BOARD, items_page: { items: [item] } }] })
      );

      const result = await issues.searchIssues(host(CREDENTIALS), {
        searchTerm: 'search',
        limit: 20,
      });

      expect(result).toEqual({
        success: true,
        data: [expect.objectContaining({ identifier: item.id, title: item.name })],
      });
      expect(requestBody().variables).toEqual(
        expect.objectContaining({
          queryParams: {
            rules: [{ column_id: 'name', compare_value: ['search'], operator: 'contains_text' }],
            order_by: [{ column_id: '__last_updated__', direction: 'desc' }],
          },
        })
      );
    });
  });

  describe('getIssue', () => {
    const CONTEXT_ITEM = {
      ...ITEM,
      board: { id: '111', name: 'Sprint Board', url: 'https://myteam.monday.com/boards/111' },
      updates: [] as unknown[],
    };

    it('returns the item with updates as context', async () => {
      const update = {
        id: 'upd-1',
        text_body: 'Started investigating the auth flow.',
        created_at: '2026-05-19T09:00:00Z',
        creator: { name: 'Snir' },
      };
      fetchMock.mockResolvedValueOnce(
        graphqlResponse({ items: [{ ...CONTEXT_ITEM, updates: [update] }] })
      );

      const result = await getIssue(host(CREDENTIALS), {
        identifier: ITEM.id,
      });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          identifier: ITEM.id,
          title: ITEM.name,
          context: expect.stringContaining(update.text_body),
        }),
      });
    });

    it('returns the item description exported from a Monday Doc', async () => {
      const docValue = JSON.stringify({
        files: [{ fileType: 'MONDAY_DOC_ITEM_DESCRIPTION', objectId: 42034047 }],
      });
      const item = {
        ...CONTEXT_ITEM,
        column_values: [{ id: 'monday_doc_v2', type: 'direct_doc', text: '', value: docValue }],
      };
      fetchMock
        .mockResolvedValueOnce(graphqlResponse({ items: [item] }))
        .mockResolvedValueOnce(
          graphqlResponse({ export_markdown_from_doc: { markdown: 'Doc description content' } })
        );

      const result = await getIssue(host(CREDENTIALS), {
        identifier: ITEM.id,
      });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          identifier: ITEM.id,
          description: 'Doc description content',
        }),
      });
      const exportBody = requestBody(1);
      expect(exportBody.query).toContain('export_markdown_from_doc');
      expect(exportBody.variables).toEqual({ docId: '42034047' });
    });

    it('returns a not-found error when the item does not exist', async () => {
      fetchMock.mockResolvedValueOnce(graphqlResponse({ items: [] }));

      const result = await getIssue(host(CREDENTIALS), {
        identifier: '999',
      });

      expect(result).toEqual({
        success: false,
        error: { type: 'not_found_or_no_access', message: 'Item 999 not found.' },
      });
    });
  });
});

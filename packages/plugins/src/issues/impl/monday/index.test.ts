import type { Logger } from '@emdash/shared/logger';
import type * as MondayApi from '@mondaydotcomorg/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { provider } from './index';

const mondaySdk = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('@mondaydotcomorg/api', async (importOriginal) => {
  const actual = await importOriginal<typeof MondayApi>();
  return {
    ...actual,
    ApiClient: class {
      request = mondaySdk.request;
    },
  };
});

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

const CREDENTIALS = { apiToken: 'tok' };

function host(
  credentials: ConnectedIntegrationHostContext['credentials']
): ConnectedIntegrationHostContext {
  return { log: logger, credentials };
}

function requestBody(callIndex = 0): { query: string; variables: Record<string, unknown> } {
  const [query, variables] = mondaySdk.request.mock.calls[callIndex] ?? [];
  return { query, variables };
}

afterEach(() => {
  mondaySdk.request.mockReset();
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
    it('returns items from accessible boards mapped to issues', async () => {
      mondaySdk.request.mockResolvedValueOnce({ boards: [BOARD] });

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
      const body = requestBody();
      expect(body.query).toContain('boards(limit: 20)');
      expect(body.variables).not.toHaveProperty('boardIds');
    });

    it('orders items by updated_at descending', async () => {
      mondaySdk.request.mockResolvedValueOnce({ boards: [BOARD] });

      await issues.listIssues(host(CREDENTIALS), { limit: 50 });

      const body = requestBody();
      expect(body.query).toContain('query_params');
      expect(body.variables).toEqual(
        expect.objectContaining({
          queryParams: {
            order_by: [{ column_id: '__last_updated__', direction: 'desc' }],
          },
        })
      );
    });

    it('ignores stale board scope fields from older credentials', async () => {
      mondaySdk.request.mockResolvedValueOnce({ boards: [BOARD] });

      const result = await issues.listIssues(
        host({ apiToken: 'tok', boardIds: ['111'], boardUrls: [] }),
        { limit: 50 }
      );

      expect(result).toEqual({ success: true, data: [expect.any(Object)] });
      const body = requestBody();
      expect(body.query).toContain('boards(limit: 20)');
      expect(body.variables).not.toHaveProperty('boardIds');
    });

    it('returns a generic error when the API query fails', async () => {
      mondaySdk.request.mockRejectedValueOnce(new Error('Rate limit exceeded'));

      const result = await issues.listIssues(host(CREDENTIALS), { limit: 50 });

      expect(result).toEqual({
        success: false,
        error: { type: 'generic', message: 'Rate limit exceeded' },
      });
    });

    it('throws when the host provides no API token', async () => {
      const result = await issues.listIssues(host({}), { limit: 50 });

      expect(result).toEqual({
        success: false,
        error: { type: 'invalid_input', message: 'Monday.com API token cannot be empty.' },
      });
      expect(mondaySdk.request).not.toHaveBeenCalled();
    });
  });

  describe('searchIssues', () => {
    it('returns no results for an empty search term without querying Monday', async () => {
      const result = await issues.searchIssues(host(CREDENTIALS), {
        searchTerm: '   ',
        limit: 20,
      });

      expect(result).toEqual({ success: true, data: [] });
      expect(mondaySdk.request).not.toHaveBeenCalled();
    });

    it('filters items by search term and orders by updated_at descending', async () => {
      const item = { ...ITEM, id: '202', name: 'Search feature' };
      mondaySdk.request.mockResolvedValueOnce({
        boards: [{ ...BOARD, items_page: { items: [item] } }],
      });

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
      mondaySdk.request.mockResolvedValueOnce({ items: [{ ...CONTEXT_ITEM, updates: [update] }] });

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
      mondaySdk.request.mockResolvedValueOnce({ items: [item] }).mockResolvedValueOnce({
        export_markdown_from_doc: { markdown: 'Doc description content' },
      });

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
      mondaySdk.request.mockResolvedValueOnce({ items: [] });

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

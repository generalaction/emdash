import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetSecret = vi.fn();
const mockGetSecret = vi.fn();
const mockDeleteSecret = vi.fn();

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    setSecret: (...args: unknown[]) => mockSetSecret(...args),
    getSecret: (...args: unknown[]) => mockGetSecret(...args),
    deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn() },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { NOTION_API_ERROR_MESSAGES, NotionConnectionService } from './notion-connection-service';

function jsonResponse(body: unknown): { ok: boolean; json: () => Promise<unknown> } {
  return { ok: true, json: async () => body };
}

describe('NotionConnectionService', () => {
  let service: NotionConnectionService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new NotionConnectionService();
  });

  describe('saveCredentials', () => {
    it('validates token against Notion API and stores credentials', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: 'bot-1', name: 'Emdash', bot: { workspace_name: 'Acme' } })
      );

      const input = { token: 'secret_token', databaseUrls: '' };
      const result = await service.saveCredentials(input);

      expect(result).toEqual({ success: true, displayName: 'Acme' });
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-notion-credentials',
        JSON.stringify({ token: input.token, scope: { type: 'all-shared' } })
      );
    });

    it('sends Notion auth and version headers', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'bot-1', name: 'Emdash' }));

      await service.saveCredentials({ token: 'secret_token', databaseUrls: '' });

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Headers;
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.notion.com/v1/users/me');
      expect(headers.get('Authorization')).toBe('Bearer secret_token');
      expect(headers.get('Notion-Version')).toEqual(expect.any(String));
    });

    it('parses and deduplicates data source IDs from URLs and raw IDs', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'bot-1', name: 'Emdash' }));

      const dataSourceId = 'abcdefabcdefabcdefabcdefabcdefab';
      const result = await service.saveCredentials({
        token: 'secret_token',
        databaseUrls: `https://www.notion.so/acme/Roadmap-${dataSourceId}?v=123\n${dataSourceId}`,
      });

      expect(result.success).toBe(true);
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-notion-credentials',
        JSON.stringify({
          token: 'secret_token',
          scope: {
            type: 'data-sources',
            dataSourceIds: [dataSourceId],
            sourceUrls: [`https://www.notion.so/acme/Roadmap-${dataSourceId}?v=123`, dataSourceId],
          },
        })
      );
    });

    it('parses data source IDs from notion.com and app.notion.com URLs', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'bot-1', name: 'Emdash' }));

      const dataSourceId = 'abcdefabcdefabcdefabcdefabcdefab';
      const notionComUrl = `https://www.notion.com/acme/Roadmap-${dataSourceId}?v=123`;
      const appNotionUrl = `https://app.notion.com/p/Roadmap-${dataSourceId}`;
      const result = await service.saveCredentials({
        token: 'secret_token',
        databaseUrls: `${notionComUrl}, ${appNotionUrl}`,
      });

      expect(result.success).toBe(true);
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-notion-credentials',
        JSON.stringify({
          token: 'secret_token',
          scope: {
            type: 'data-sources',
            dataSourceIds: [dataSourceId],
            sourceUrls: [notionComUrl, appNotionUrl],
          },
        })
      );
    });

    it('returns error for invalid database URL format', async () => {
      const result = await service.saveCredentials({
        token: 'secret_token',
        databaseUrls: 'https://example.com/not-notion',
      });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('Could not parse Notion ID'),
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('preserves the existing token when explicitly requested', async () => {
      mockGetSecret.mockResolvedValueOnce(
        JSON.stringify({ token: 'stored-token', scope: { type: 'all-shared' } })
      );
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'bot-1', name: 'Emdash' }));

      const dataSourceId = 'abcdefabcdefabcdefabcdefabcdefab';
      const result = await service.saveCredentials({
        databaseUrls: dataSourceId,
        preserveToken: true,
      });

      expect(result.success).toBe(true);
      expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toEqual(expect.any(Headers));
      expect(((mockFetch.mock.calls[0][1] as RequestInit).headers as Headers).get('Authorization'))
        .toBe('Bearer stored-token');
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-notion-credentials',
        JSON.stringify({
          token: 'stored-token',
          scope: {
            type: 'data-sources',
            dataSourceIds: [dataSourceId],
            sourceUrls: [dataSourceId],
          },
        })
      );
    });

    it('returns error for empty token', async () => {
      const result = await service.saveCredentials({ token: '  ', databaseUrls: '' });

      expect(result).toEqual({
        success: false,
        error: 'Access token cannot be empty.',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns a helpful authentication error when Notion rejects the token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      });

      const result = await service.saveCredentials({ token: 'bad-token', databaseUrls: '' });

      expect(result).toEqual({
        success: false,
        error: NOTION_API_ERROR_MESSAGES.AUTH_FAILED,
      });
    });
  });

  describe('getStoredCredentials', () => {
    it('defaults missing database scope to all shared pages', async () => {
      mockGetSecret.mockResolvedValueOnce(JSON.stringify({ token: 'stored-token' }));

      const result = await service.getStoredCredentials();

      expect(result).toEqual({ token: 'stored-token', scope: { type: 'all-shared' } });
    });

    it('migrates legacy database scope to data source scope', async () => {
      const dataSourceId = 'abcdefabcdefabcdefabcdefabcdefab';
      mockGetSecret.mockResolvedValueOnce(
        JSON.stringify({
          token: 'stored-token',
          databaseIds: [dataSourceId, dataSourceId],
          databaseUrls: ['https://notion.so/example'],
        })
      );

      const result = await service.getStoredCredentials();

      expect(result).toEqual({
        token: 'stored-token',
        scope: {
          type: 'data-sources',
          dataSourceIds: [dataSourceId],
          sourceUrls: ['https://notion.so/example'],
        },
      });
    });

    it('returns null for invalid stored credential shapes', async () => {
      mockGetSecret.mockResolvedValueOnce(JSON.stringify({ token: 123 }));

      const result = await service.getStoredCredentials();

      expect(result).toBeNull();
    });
  });

  describe('clearCredentials', () => {
    it('deletes stored credentials', async () => {
      const result = await service.clearCredentials();

      expect(result).toEqual({ success: true });
      expect(mockDeleteSecret).toHaveBeenCalledWith('emdash-notion-credentials');
    });
  });

  describe('request', () => {
    it('normalizes Notion database access errors into actionable messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          message:
            'Could not find database with ID: 94143f25-f30a-47ac-ac47-4a2d0692d2b0. Make sure the relevant pages and databases are shared with your integration "emdash".',
        }),
      });

      await expect(
        service.request('token', '/data_sources/abc/query', { method: 'POST' })
      ).rejects.toThrow(
        'Notion cannot access the configured data source. Share the page or database with emdash, or update the scope URLs in Emdash settings.'
      );
    });
  });
});

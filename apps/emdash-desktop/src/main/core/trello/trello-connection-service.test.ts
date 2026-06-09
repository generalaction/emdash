import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import { TRELLO_API_ERROR_MESSAGES, TrelloConnectionService } from './trello-connection-service';

function jsonResponse(body: unknown): { ok: boolean; json: () => Promise<unknown> } {
  return { ok: true, json: async () => body };
}

describe('TrelloConnectionService', () => {
  let service: TrelloConnectionService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrelloConnectionService();
  });

  describe('saveCredentials', () => {
    it('validates credentials against Trello API and stores them', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: 'member-1', fullName: 'Jan', username: 'jan' })
      );

      const input = { apiKey: 'key', token: 'valid-token', boardUrls: '' };
      const result = await service.saveCredentials(input);

      expect(result).toEqual({ success: true, displayName: 'Jan' });
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-trello-credentials',
        JSON.stringify({ apiKey: input.apiKey, token: input.token, boardIds: [] })
      );
    });

    it('sends the key and token as query parameters', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'member-1', fullName: 'Jan' }));

      await service.saveCredentials({ apiKey: 'key', token: 'tok', boardUrls: '' });

      const url = mockFetch.mock.calls[0][0] as URL;
      expect(url.pathname).toBe('/1/members/me');
      expect(url.searchParams.get('key')).toBe('key');
      expect(url.searchParams.get('token')).toBe('tok');
    });

    it('resolves and deduplicates board IDs from URLs', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 'member-1', fullName: 'Jan' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'board-abc' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'board-def' }));

      const input = {
        apiKey: 'key',
        token: 'valid-token',
        boardUrls:
          'https://trello.com/b/aBcD1234/my-board\nhttps://trello.com/b/eFgH5678, https://trello.com/b/aBcD1234',
      };
      const result = await service.saveCredentials(input);

      expect(result.success).toBe(true);
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-trello-credentials',
        JSON.stringify({
          apiKey: input.apiKey,
          token: input.token,
          boardIds: ['board-abc', 'board-def'],
        })
      );
    });

    it('returns error for invalid board URL format', async () => {
      const result = await service.saveCredentials({
        apiKey: 'key',
        token: 'valid-token',
        boardUrls: 'not-a-url',
      });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('Could not parse board ID'),
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns error when too many boards are configured', async () => {
      const boardUrls = Array.from(
        { length: 21 },
        (_, index) => `https://trello.com/b/board${index}`
      ).join('\n');

      const result = await service.saveCredentials({
        apiKey: 'key',
        token: 'valid-token',
        boardUrls,
      });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('limited to 20 boards'),
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns error for empty API key or token', async () => {
      const result = await service.saveCredentials({ apiKey: '  ', token: 'tok', boardUrls: '' });

      expect(result).toEqual({
        success: false,
        error: 'Trello API key and token cannot be empty.',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns error for inaccessible boards', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 'member-1', fullName: 'Jan' }))
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'board not found' });

      const result = await service.saveCredentials({
        apiKey: 'key',
        token: 'valid-token',
        boardUrls: 'https://trello.com/b/aBcD1234',
      });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('Could not access Trello board "aBcD1234"'),
      });
    });

    it('returns a helpful authentication error when Trello rejects the credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'invalid token',
      });

      const result = await service.saveCredentials({
        apiKey: 'key',
        token: 'bad-token',
        boardUrls: '',
      });

      expect(result).toEqual({
        success: false,
        error: TRELLO_API_ERROR_MESSAGES.AUTH_FAILED,
      });
    });
  });

  describe('getStoredCredentials', () => {
    it('defaults missing board IDs to an empty list', async () => {
      mockGetSecret.mockResolvedValueOnce(JSON.stringify({ apiKey: 'key', token: 'tok' }));

      const result = await service.getStoredCredentials();

      expect(result).toEqual({ apiKey: 'key', token: 'tok', boardIds: [] });
    });

    it('returns null for invalid stored credential shapes', async () => {
      mockGetSecret.mockResolvedValueOnce(JSON.stringify({ apiKey: 'key', token: 123 }));

      const result = await service.getStoredCredentials();

      expect(result).toBeNull();
    });
  });

  describe('checkConnection', () => {
    it('returns connected with display name when credentials are valid', async () => {
      mockGetSecret.mockResolvedValueOnce(JSON.stringify({ apiKey: 'key', token: 'tok' }));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: 'member-1', fullName: 'Jan', username: 'jan' })
      );

      const result = await service.checkConnection();

      expect(result.connected).toBe(true);
      expect(result.displayName).toBe('Jan');
    });

    it('returns not connected when no stored credentials', async () => {
      mockGetSecret.mockResolvedValueOnce(null);

      const result = await service.checkConnection();

      expect(result.connected).toBe(false);
    });
  });

  describe('clearCredentials', () => {
    it('deletes stored credentials', async () => {
      const result = await service.clearCredentials();

      expect(result).toEqual({ success: true });
      expect(mockDeleteSecret).toHaveBeenCalledWith('emdash-trello-credentials');
    });
  });
});

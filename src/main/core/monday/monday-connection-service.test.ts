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

import { MONDAY_API_ERROR_MESSAGES, MondayConnectionService } from './monday-connection-service';

describe('MondayConnectionService', () => {
  let service: MondayConnectionService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new MondayConnectionService();
  });

  describe('saveCredentials', () => {
    it('validates token against Monday API and stores credentials', async () => {
      const meResponse = {
        data: { me: { id: '123', name: 'Snir', account: { name: 'My Team' } } },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => meResponse,
      });

      const input = { token: 'valid-token', boardUrls: '' };
      const result = await service.saveCredentials(input);

      expect(result).toEqual({ success: true, workspaceName: meResponse.data.me.account.name });
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-monday-credentials',
        JSON.stringify({ token: input.token, boardIds: [], boardUrls: [] })
      );
    });

    it('parses and deduplicates board IDs from URLs', async () => {
      const meResponse = {
        data: { me: { id: '123', name: 'Snir', account: { name: 'My Team' } } },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => meResponse,
      });

      const input = {
        token: 'valid-token',
        boardUrls:
          'https://myteam.monday.com/boards/123456\nhttps://myteam.monday.com/boards/789012, https://myteam.monday.com/boards/123456',
      };
      const result = await service.saveCredentials(input);

      expect(result.success).toBe(true);
      expect(mockSetSecret).toHaveBeenCalledWith(
        'emdash-monday-credentials',
        JSON.stringify({
          token: input.token,
          boardIds: ['123456', '789012'],
          boardUrls: [
            'https://myteam.monday.com/boards/123456',
            'https://myteam.monday.com/boards/789012',
          ],
        })
      );
    });

    it('returns error for invalid board URL format', async () => {
      const result = await service.saveCredentials({
        token: 'valid-token',
        boardUrls: 'not-a-url',
      });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('Could not parse board ID'),
      });
    });

    it('returns error for empty token', async () => {
      const result = await service.saveCredentials({ token: '  ', boardUrls: '' });

      expect(result).toEqual({ success: false, error: 'Monday.com API token cannot be empty.' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns error when API validation fails', async () => {
      const errorResponse = { errors: [{ message: 'Not Authenticated' }] };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => errorResponse,
      });

      const result = await service.saveCredentials({ token: 'bad-token', boardUrls: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain(errorResponse.errors[0].message);
    });

    it('returns a helpful authentication error when Monday rejects the token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      });

      const result = await service.saveCredentials({ token: 'bad-token', boardUrls: '' });

      expect(result).toEqual({
        success: false,
        error: MONDAY_API_ERROR_MESSAGES.AUTH_FAILED,
      });
    });
  });

  describe('getStoredCredentials', () => {
    it('defaults missing legacy board IDs to an empty list', async () => {
      mockGetSecret.mockResolvedValueOnce(JSON.stringify({ token: 'stored-token' }));

      const result = await service.getStoredCredentials();

      expect(result).toEqual({ token: 'stored-token', boardIds: [], boardUrls: [] });
    });

    it('returns null for invalid stored credential shapes', async () => {
      mockGetSecret.mockResolvedValueOnce(JSON.stringify({ token: 123, boardIds: [] }));

      const result = await service.getStoredCredentials();

      expect(result).toBeNull();
    });
  });

  describe('checkConnection', () => {
    it('returns connected with workspace name when token is valid', async () => {
      const credentials = { token: 'stored-token', boardIds: [] };
      mockGetSecret.mockResolvedValueOnce(JSON.stringify(credentials));

      const meResponse = {
        data: { me: { id: '123', name: 'Snir', account: { name: 'My Team' } } },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => meResponse,
      });

      const result = await service.checkConnection();

      expect(result.connected).toBe(true);
      expect(result.displayName).toBe(meResponse.data.me.account.name);
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
      expect(mockDeleteSecret).toHaveBeenCalledWith('emdash-monday-credentials');
    });
  });
});

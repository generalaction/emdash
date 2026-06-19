import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetSecret = vi.fn();
const mockGetSecret = vi.fn();
const mockDeleteSecret = vi.fn();
const kvStore = new Map<string, unknown>();

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    setSecret: (...args: unknown[]) => mockSetSecret(...args),
    getSecret: (...args: unknown[]) => mockGetSecret(...args),
    deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  },
}));

vi.mock('@main/db/kv', () => ({
  KV: class MockKV {
    async get(key: string) {
      return kvStore.get(key) ?? null;
    }

    async set(key: string, value: unknown) {
      kvStore.set(key, value);
    }

    async del(key: string) {
      kvStore.delete(key);
    }
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { PlaneConnectionService } from './plane-connection-service';

describe('PlaneConnectionService', () => {
  let service: PlaneConnectionService;

  beforeEach(() => {
    vi.resetAllMocks();
    kvStore.clear();
    service = new PlaneConnectionService();
  });

  it('rejects invalid API base URLs before saving', async () => {
    const result = await service.saveCredentials({
      apiBaseUrl: 'plane.example.com',
      workspaceSlug: 'my-team',
      token: 'token',
    });

    expect(result).toEqual({ success: false, error: 'A valid Plane API base URL is required.' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSetSecret).not.toHaveBeenCalled();
  });

  it('validates and stores normalized self-hosted credentials', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ display_name: 'Ada Lovelace' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

    const result = await service.saveCredentials({
      apiBaseUrl: 'https://plane.example.com/',
      workspaceSlug: 'my-team',
      token: ' plane_api_token ',
    });

    expect(result).toEqual({ success: true, displayName: 'Ada Lovelace' });
    expect(mockSetSecret).toHaveBeenCalledWith('emdash-plane-token', 'plane_api_token');
    expect(kvStore.get('connection')).toEqual({
      apiBaseUrl: 'https://plane.example.com',
      workspaceSlug: 'my-team',
    });

    const firstUrl = mockFetch.mock.calls[0]?.[0] as URL;
    const firstOptions = mockFetch.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(firstUrl.toString()).toBe('https://plane.example.com/api/v1/users/me/');
    expect(firstOptions.headers['X-API-Key']).toBe('plane_api_token');
  });

  it('returns not connected when no credentials are stored', async () => {
    const result = await service.checkConnection();

    expect(result).toEqual({
      connected: false,
      capabilities: {
        requiresProjectPath: false,
        requiresRepositoryUrl: false,
        supportsIssueContext: true,
      },
    });
  });

  it('checks stored credentials', async () => {
    kvStore.set('connection', {
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
    });
    mockGetSecret.mockResolvedValueOnce('stored-token');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: 'ada@example.com' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

    const result = await service.checkConnection();

    expect(result.connected).toBe(true);
    expect(result.displayName).toBe('ada@example.com');
    expect(result.displayDetail).toBe('my-team on api.plane.so');
  });

  it('reports configured only when connection metadata and token are stored', async () => {
    expect(await service.isConfigured()).toBe(false);

    kvStore.set('connection', {
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
    });
    mockGetSecret.mockResolvedValueOnce(null).mockResolvedValueOnce('stored-token');

    expect(await service.isConfigured()).toBe(false);
    expect(await service.isConfigured()).toBe(true);
  });

  it('clears encrypted token and non-secret config', async () => {
    kvStore.set('connection', {
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
    });

    const result = await service.clearCredentials();

    expect(result).toEqual({ success: true });
    expect(mockDeleteSecret).toHaveBeenCalledWith('emdash-plane-token');
    expect(kvStore.has('connection')).toBe(false);
  });
});

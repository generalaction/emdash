import { noopLogger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provider } from './index';

const auth = provider.behavior.auth;
if (!auth) throw new Error('Plane integration plugin has no auth behavior');

const host = { log: noopLogger };

describe('plane integration verify', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects invalid API base URLs before making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await auth.verify(host, {
      apiBaseUrl: 'plane.example.com',
      workspaceSlug: 'my-team',
      apiKey: 'token',
    });

    expect(result).toEqual({
      connected: false,
      error: 'A valid Plane API base URL is required.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates and returns normalized self-hosted credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ display_name: 'Ada Lovelace' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await auth.verify(host, {
      apiBaseUrl: 'https://plane.example.com/',
      workspaceSlug: 'my-team',
      apiKey: ' plane_api_token ',
    });

    expect(result).toEqual({
      connected: true,
      displayName: 'Ada Lovelace',
      displayDetail: 'my-team on plane.example.com',
      credentials: {
        apiBaseUrl: 'https://plane.example.com',
        workspaceSlug: 'my-team',
        apiKey: 'plane_api_token',
      },
    });

    const firstUrl = fetchMock.mock.calls[0]?.[0] as URL;
    const firstOptions = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(firstUrl.toString()).toBe('https://plane.example.com/api/v1/users/me/');
    expect(firstOptions.headers['X-API-Key']).toBe('plane_api_token');
  });

  it('falls back to the email for the display name', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: 'ada@example.com' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await auth.verify(host, {
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
      apiKey: 'stored-token',
    });

    expect(result).toEqual(
      expect.objectContaining({
        connected: true,
        displayName: 'ada@example.com',
        displayDetail: 'my-team on api.plane.so',
      })
    );
  });

  it('maps authentication failures to a friendly error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid API key' }),
      })
    );

    const result = await auth.verify(host, {
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
      apiKey: 'bad-token',
    });

    expect(result).toEqual({
      connected: false,
      error: 'Plane authentication failed. Check your API key and permissions.',
    });
  });
});

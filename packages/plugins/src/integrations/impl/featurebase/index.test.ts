import { noopLogger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATUREBASE_API_URL, FEATUREBASE_API_VERSION } from './client';
import { provider } from './index';

const auth = provider.behavior.auth;
if (!auth) throw new Error('Featurebase integration plugin has no auth behavior');

const host = { log: noopLogger };

describe('featurebase integration verify', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('verifies the API key with a minimal posts request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await auth.verify(host, { apiKey: 'fb-token' });

    expect(result).toEqual({ connected: true });
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    const options = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(url.toString()).toBe(`${FEATUREBASE_API_URL}/v2/posts?limit=1`);
    expect(options.headers).toEqual({
      Authorization: 'Bearer fb-token',
      'Featurebase-Version': FEATUREBASE_API_VERSION,
    });
  });

  it('maps authentication failures to a friendly error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({
          error: { message: 'Invalid API key', status: 401 },
        }),
      })
    );

    const result = await auth.verify(host, { apiKey: 'bad-token' });

    expect(result).toEqual({
      connected: false,
      error: 'Featurebase authentication failed. Check your API key.',
    });
  });

  it('rejects an empty API key without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await auth.verify(host, { apiKey: '   ' });

    expect(result).toEqual({
      connected: false,
      error: 'Featurebase API key cannot be empty.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

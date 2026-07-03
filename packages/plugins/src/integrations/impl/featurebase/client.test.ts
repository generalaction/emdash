import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FEATUREBASE_API_URL,
  FEATUREBASE_API_VERSION,
  FeaturebaseClient,
  type FeaturebaseHttpError,
} from './client';

describe('FeaturebaseClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends bearer auth, API version, and query params to Featurebase', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new FeaturebaseClient('fb-token');
    await client.get('/v2/posts', {
      limit: 10,
      sortBy: 'recent',
      sortOrder: 'desc',
      q: 'dark mode',
      inReview: undefined,
    });

    const url = fetchMock.mock.calls[0]?.[0] as URL;

    expect(fetchMock).toHaveBeenCalledWith(url, {
      headers: {
        Authorization: 'Bearer fb-token',
        'Featurebase-Version': FEATUREBASE_API_VERSION,
      },
    });
    expect(url.toString()).toBe(
      `${FEATUREBASE_API_URL}/v2/posts?limit=10&sortBy=recent&sortOrder=desc&q=dark+mode`
    );
  });

  it('throws FeaturebaseHttpError with API error message when request fails', async () => {
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

    const client = new FeaturebaseClient('bad-token');

    await expect(client.get('/v2/posts')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid API key',
    } satisfies Partial<FeaturebaseHttpError>);
  });
});

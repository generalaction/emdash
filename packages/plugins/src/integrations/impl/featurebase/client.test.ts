import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFeaturebaseClient,
  FEATUREBASE_API_URL,
  FEATUREBASE_API_VERSION,
  readFeaturebaseCredentials,
  verifyFeaturebaseCredentials,
} from './client';

const postsListMock = vi.hoisted(() => vi.fn());
const FeaturebaseMock = vi.hoisted(() =>
  vi.fn(() => ({
    feedback: {
      posts: {
        list: postsListMock,
      },
    },
  }))
);

vi.mock('featurebase-node', () => ({
  default: FeaturebaseMock,
}));

describe('Featurebase client', () => {
  beforeEach(() => {
    FeaturebaseMock.mockClear();
    postsListMock.mockReset();
  });

  it('parses and trims credentials', () => {
    expect(readFeaturebaseCredentials({ apiKey: '  fb-token  ' })).toEqual({
      success: true,
      data: { apiKey: 'fb-token' },
    });
  });

  it('constructs the SDK client with auth, base URL, and API version', () => {
    createFeaturebaseClient({ apiKey: 'fb-token' });

    expect(FeaturebaseMock).toHaveBeenCalledWith({
      apiKey: 'fb-token',
      baseURL: FEATUREBASE_API_URL,
      defaultHeaders: {
        'Featurebase-Version': FEATUREBASE_API_VERSION,
      },
    });
  });

  it('verifies the API key with a minimal posts request', async () => {
    postsListMock.mockResolvedValue({ data: [] });

    const result = await verifyFeaturebaseCredentials({ apiKey: 'fb-token' });

    expect(postsListMock).toHaveBeenCalledWith({ limit: 1 });
    expect(result).toEqual({
      success: true,
      data: {
        credentials: {
          apiKey: 'fb-token',
        },
      },
    });
  });

  it('maps authentication failures to an integration error', async () => {
    postsListMock.mockRejectedValue(Object.assign(new Error('Invalid API key'), { status: 401 }));

    const result = await verifyFeaturebaseCredentials({ apiKey: 'bad-token' });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'auth_failed',
        message: 'Featurebase authentication failed. Check your credentials.',
      },
    });
  });

  it('rejects an empty API key without creating a client', async () => {
    const result = await verifyFeaturebaseCredentials({ apiKey: '   ' });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Featurebase API key is required.',
      },
    });
    expect(FeaturebaseMock).not.toHaveBeenCalled();
  });
});

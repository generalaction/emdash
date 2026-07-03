import { err, ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyFeaturebaseCredentials } from './client';
import { provider } from './index';

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return {
    ...actual,
    verifyFeaturebaseCredentials: vi.fn(),
  };
});

const auth = provider.behavior.auth;
if (!auth) throw new Error('Featurebase integration plugin has no auth behavior');

const host = { log: noopLogger };
const mockVerifyFeaturebaseCredentials = vi.mocked(verifyFeaturebaseCredentials);

describe('featurebase integration verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns connected with normalized credentials when verification succeeds', async () => {
    mockVerifyFeaturebaseCredentials.mockResolvedValue(ok({ credentials: { apiKey: 'fb-token' } }));

    const result = await auth.verify(host, { apiKey: 'fb-token' });

    expect(mockVerifyFeaturebaseCredentials).toHaveBeenCalledWith({ apiKey: 'fb-token' });
    expect(result).toEqual({
      connected: true,
      credentials: {
        apiKey: 'fb-token',
      },
    });
  });

  it('returns the integration error message when verification fails', async () => {
    mockVerifyFeaturebaseCredentials.mockResolvedValue(
      err({
        type: 'auth_failed',
        message: 'Featurebase authentication failed. Check your credentials.',
      })
    );

    const result = await auth.verify(host, { apiKey: 'bad-token' });

    expect(result).toEqual({
      connected: false,
      error: 'Featurebase authentication failed. Check your credentials.',
    });
  });
});

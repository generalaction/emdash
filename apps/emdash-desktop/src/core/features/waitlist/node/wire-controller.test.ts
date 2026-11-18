import { noopLogger } from '@emdash/shared/logger';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitlistContract } from '../api/contract';
import { WAITLIST_ERROR_MESSAGES } from './join-waitlist';
import { createWaitlistWireController, type WaitlistOperations } from './wire-controller';

const operations: WaitlistOperations = {
  getSignupConfig: async () => ({
    apiUrl: 'https://waitlist.test/api/waitlist',
    source: 'desktop app v1.2.10',
  }),
};

describe('waitlist Wire controller', () => {
  const fetchMock = vi.fn<typeof fetch>();

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  async function join(ops: WaitlistOperations = operations) {
    vi.stubGlobal('fetch', fetchMock);
    const wire = createTestWire(waitlistContract, createWaitlistWireController(ops, noopLogger));
    try {
      return await wire.client.join({ email: 'jane@example.com', note: '' });
    } finally {
      await wire.dispose();
    }
  }

  it('reports success', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));

    await expect(join()).resolves.toEqual({ success: true });
  });

  it('passes the user-facing message for a failed signup to the renderer', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ok: false, error: 'rate_limited' }, { status: 429 })
    );

    await expect(join()).resolves.toEqual({
      success: false,
      error: WAITLIST_ERROR_MESSAGES.rateLimited,
    });
  });

  it('keeps unexpected internal errors out of the renderer message', async () => {
    const result = await join({
      getSignupConfig: async () => {
        throw new Error('app version unavailable');
      },
    });

    expect(result).toEqual({ success: false, error: WAITLIST_ERROR_MESSAGES.rejected });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

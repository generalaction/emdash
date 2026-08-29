import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(async () => new Response('ok')),
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch },
  protocol: {
    handle: mocks.handle,
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

const { APP_ORIGIN, setupAppProtocol } = await import('./protocol');

describe('app protocol file URLs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses Node file URL encoding for spaces, hashes, percent signs, and Unicode', async () => {
    const root = '/tmp/Emdash App #100%/資料';
    setupAppProtocol(root);
    const handler = mocks.handle.mock.calls[0]?.[1] as
      | ((request: { url: string }) => Promise<Response>)
      | undefined;
    expect(handler).toBeDefined();

    await handler?.({ url: `${APP_ORIGIN}/assets/report%20%23100%25-%E8%B3%87%E6%96%99.txt` });

    expect(mocks.fetch).toHaveBeenCalledWith(
      pathToFileURL(`${root}/assets/report #100%-資料.txt`).href
    );
  });
});

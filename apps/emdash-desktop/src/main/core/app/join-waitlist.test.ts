import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinWaitlist } from './join-waitlist';

const mockEnv = vi.hoisted(() => ({
  build: {} as Record<string, string | undefined>,
  dev: {} as Record<string, string | undefined>,
}));

vi.mock('@main/lib/env', () => ({ env: mockEnv }));

describe('joinWaitlist', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    mockEnv.build = {
      VITE_WAITLIST_SUPABASE_URL: 'https://example.supabase.co/',
      VITE_WAITLIST_SUPABASE_ANON_KEY: 'anon-key',
    };
    mockEnv.dev = {};
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('inserts a normalized signup in the same format as the website', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

    await joinWaitlist({ email: '  Jane@Example.COM ', message: '  Team of 12  ' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co/rest/v1/cloud_inquiries');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' });
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'jane@example.com',
      message: 'Emdash 2.0 waitlist\n\nTeam of 12',
    });
  });

  it('omits an empty message body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

    await joinWaitlist({ email: 'jane@example.com', message: '   ' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init?.body as string).message).toBe('Emdash 2.0 waitlist');
  });

  it('treats an existing signup as success', async () => {
    fetchMock.mockResolvedValue(new Response('{"code":"23505"}', { status: 409 }));

    await expect(joinWaitlist({ email: 'jane@example.com', message: '' })).resolves.toBe(undefined);
  });

  it('throws on other HTTP errors', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));

    await expect(joinWaitlist({ email: 'jane@example.com', message: '' })).rejects.toThrow(
      'Waitlist signup returned 401: nope'
    );
  });

  it('throws without calling the network when not configured', async () => {
    mockEnv.build = {};

    await expect(joinWaitlist({ email: 'jane@example.com', message: '' })).rejects.toThrow(
      'not configured'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

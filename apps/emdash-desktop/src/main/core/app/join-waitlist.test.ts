import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinWaitlist } from './join-waitlist';

const mockEnv = vi.hoisted(() => ({
  build: {} as Record<string, string | undefined>,
  dev: {} as Record<string, string | undefined>,
}));

vi.mock('@main/lib/env', () => ({ env: mockEnv }));

const SOURCE = 'desktop app v1.2.10';

describe('joinWaitlist', () => {
  const fetchMock = vi.fn<typeof fetch>();

  const requests = () =>
    fetchMock.mock.calls.map(([url, init]) => ({
      url,
      headers: init?.headers,
      body: JSON.parse(init?.body as string) as Record<string, string>,
    }));

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

  it('inserts a normalized signup tagged with its source, like the website', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

    await joinWaitlist({ email: '  Jane@Example.COM ', note: '   ', source: SOURCE });

    expect(requests()).toEqual([
      {
        url: 'https://example.supabase.co/rest/v1/cloud_inquiries',
        headers: expect.objectContaining({ apikey: 'anon-key', Authorization: 'Bearer anon-key' }),
        body: {
          email: 'jane@example.com',
          message: 'Emdash 2.0 waitlist\n\nSource: desktop app v1.2.10',
        },
      },
    ]);
  });

  it('sends the note as a separate waitlist_notes row', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 201 }));

    await joinWaitlist({ email: 'jane@example.com', note: '  Team of 12  ', source: SOURCE });

    expect(requests()[1]).toMatchObject({
      url: 'https://example.supabase.co/rest/v1/waitlist_notes',
      body: { email: 'jane@example.com', note: 'Team of 12', source: SOURCE },
    });
  });

  it('still sends the note when the email is already on the list', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"code":"23505"}', { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    await expect(
      joinWaitlist({ email: 'jane@example.com', note: 'Hi', source: SOURCE })
    ).resolves.toBe(undefined);
    expect(requests().map((request) => request.url)).toEqual([
      'https://example.supabase.co/rest/v1/cloud_inquiries',
      'https://example.supabase.co/rest/v1/waitlist_notes',
    ]);
  });

  it('throws on other signup errors without sending the note', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 401 }));

    await expect(
      joinWaitlist({ email: 'jane@example.com', note: 'Hi', source: SOURCE })
    ).rejects.toThrow('Waitlist signup returned 401: nope');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws when the note fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response('bad', { status: 400 }));

    await expect(
      joinWaitlist({ email: 'jane@example.com', note: 'Hi', source: SOURCE })
    ).rejects.toThrow('Waitlist note returned 400: bad');
  });

  it('throws without calling the network when not configured', async () => {
    mockEnv.build = {};

    await expect(
      joinWaitlist({ email: 'jane@example.com', note: '', source: SOURCE })
    ).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

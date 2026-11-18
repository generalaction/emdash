import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  joinWaitlist,
  WAITLIST_ERROR_MESSAGES,
  WaitlistJoinError,
  type WaitlistSignupConfig,
} from './join-waitlist';

const API_URL = 'https://waitlist.test/api/waitlist';
const SOURCE = 'desktop app v1.2.10';
const CONFIG: WaitlistSignupConfig = { apiUrl: API_URL, source: SOURCE };

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function failureOf(promise: Promise<unknown>): Promise<WaitlistJoinError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(WaitlistJoinError);
  return error as WaitlistJoinError;
}

describe('joinWaitlist', () => {
  const fetchMock = vi.fn<typeof fetch>();

  const requests = () =>
    fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method,
      headers: init?.headers,
      body: JSON.parse(init?.body as string) as Record<string, string>,
    }));

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends one JSON request with the normalized email, trimmed note, and source', async () => {
    await joinWaitlist(CONFIG, { email: '  Jane@Example.COM ', note: '  Team of 12  ' });

    expect(requests()).toEqual([
      {
        url: API_URL,
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: { email: 'jane@example.com', note: 'Team of 12', source: SOURCE },
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('leaves out a blank note', async () => {
    await joinWaitlist(CONFIG, { email: 'jane@example.com', note: '   ' });

    expect(requests()[0]?.body).toEqual({ email: 'jane@example.com', source: SOURCE });
  });

  it('caps the note at 1000 characters', async () => {
    await joinWaitlist(CONFIG, { email: 'jane@example.com', note: `  ${'a'.repeat(1500)}  ` });

    expect(requests()[0]?.body.note).toBe('a'.repeat(1000));
  });

  it('does not split an emoji at the note cap', async () => {
    await joinWaitlist(CONFIG, { email: 'jane@example.com', note: `${'a'.repeat(999)}🙂` });

    expect(requests()[0]?.body.note).toBe('a'.repeat(999));
  });

  it('keeps the source within the characters and length the API accepts', async () => {
    await joinWaitlist(
      { ...CONFIG, source: `desktop app v1.3.0+build.7 ${'x'.repeat(80)}` },
      { email: 'jane@example.com', note: '' }
    );

    const source = requests()[0]?.body.source ?? '';
    expect(source).toMatch(/^[\w .:/()-]{1,64}$/);
    expect(source.startsWith('desktop app v1.3.0build.7')).toBe(true);
  });

  it('treats a 200 for an email already on the list as success', async () => {
    await joinWaitlist(CONFIG, { email: 'jane@example.com', note: 'First' });
    await expect(
      joinWaitlist(CONFIG, { email: 'Jane@example.com', note: 'Second' })
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty email without calling the network', async () => {
    const error = await failureOf(joinWaitlist(CONFIG, { email: '   ', note: 'Hi' }));

    expect(error.message).toBe(WAITLIST_ERROR_MESSAGES.invalidEmail);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the user to check their address when the API rejects the email', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { ok: false, error: 'invalid_email' }));

    const error = await failureOf(joinWaitlist(CONFIG, { email: 'jane@', note: '' }));

    expect(error.message).toBe(WAITLIST_ERROR_MESSAGES.invalidEmail);
    expect(error.detail).toBe('HTTP 400 invalid_email');
  });

  it('asks the user to wait a minute when rate limited', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '60' })
    );

    const error = await failureOf(joinWaitlist(CONFIG, { email: 'jane@example.com', note: '' }));

    expect(error.message).toBe(WAITLIST_ERROR_MESSAGES.rateLimited);
    expect(error.detail).toBe('HTTP 429 rate_limited retry-after=60');
  });

  it.each([
    [500, { ok: false }],
    [502, { ok: false, error: 'upstream_unavailable' }],
    [503, 'Service Unavailable'],
  ])('reports the server as unreachable on %i', async (status, body) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body));

    const error = await failureOf(joinWaitlist(CONFIG, { email: 'jane@example.com', note: '' }));

    expect(error.message).toBe(WAITLIST_ERROR_MESSAGES.unreachable);
    expect(error.detail).toMatch(new RegExp(`^HTTP ${status}`));
  });

  it.each([
    [400, 'invalid_request'],
    [403, 'turnstile_failed'],
    [413, 'invalid_request'],
    [415, 'invalid_request'],
  ])('shows the generic failure for %i %s', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { ok: false, error: code }));

    const error = await failureOf(joinWaitlist(CONFIG, { email: 'jane@example.com', note: '' }));

    expect(error.message).toBe(WAITLIST_ERROR_MESSAGES.rejected);
    expect(error.detail).toBe(`HTTP ${status} ${code}`);
  });

  it('does not report success for a 200 without the expected body', async () => {
    fetchMock.mockResolvedValue(new Response('<html></html>', { status: 200 }));

    const error = await failureOf(joinWaitlist(CONFIG, { email: 'jane@example.com', note: '' }));

    expect(error.message).toBe(WAITLIST_ERROR_MESSAGES.rejected);
  });

  it('reports the server as unreachable on a network error', async () => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:443') })
    );

    const error = await failureOf(joinWaitlist(CONFIG, { email: 'jane@example.com', note: '' }));

    expect(error.message).toBe(WAITLIST_ERROR_MESSAGES.unreachable);
    expect(error.detail).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:443');
  });

  it('gives up and reports the server as unreachable after the timeout', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })
    );

    const error = await failureOf(
      joinWaitlist({ ...CONFIG, timeoutMs: 20 }, { email: 'jane@example.com', note: '' })
    );

    expect(error.message).toBe(WAITLIST_ERROR_MESSAGES.unreachable);
    expect(error.detail).toBe('timed out after 20ms');
  });

  it('uses a 10 second timeout by default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await joinWaitlist(CONFIG, { email: 'jane@example.com', note: '' });

    expect(timeout).toHaveBeenCalledWith(10_000);
  });
});

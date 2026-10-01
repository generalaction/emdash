import { afterEach, expect, it, vi } from 'vitest';
import { HostTrustRequests } from './host-trust-requests';

afterEach(() => vi.useRealTimers());

const prompt = { kind: 'unknown' as const, destination: 'work', prompt: 'SHA256:example' };

it('retains requests for late subscribers and accepts each id only once', async () => {
  const requests = new HostTrustRequests();
  const pending = requests.confirm(prompt, new AbortController().signal);
  const [request] = requests.snapshot();
  expect(request.prompt).toEqual(prompt);
  expect(requests.respond('missing', true)).toBe(false);
  expect(requests.respond(request.id, true)).toBe(true);
  expect(requests.respond(request.id, true)).toBe(false);
  await expect(pending).resolves.toBe(true);
  expect(requests.snapshot()).toEqual([]);
  await requests.dispose();
});

it('isolates concurrent prompts and declines canceled generations', async () => {
  const requests = new HostTrustRequests();
  const controller = new AbortController();
  const first = requests.confirm(prompt, controller.signal);
  const second = requests.confirm(
    { ...prompt, destination: 'other' },
    new AbortController().signal
  );
  const [one, two] = requests.snapshot();
  controller.abort();
  expect(requests.respond(one.id, true)).toBe(false);
  expect(requests.snapshot()).toEqual([two]);
  requests.respond(two.id, false);
  await expect(first).resolves.toBe(false);
  await expect(second).resolves.toBe(false);
  await requests.dispose();
});

it('declines on shutdown, expiration, and already canceled requests', async () => {
  vi.useFakeTimers();
  const requests = new HostTrustRequests();
  await expect(requests.confirm(prompt, AbortSignal.abort())).resolves.toBe(false);
  const expired = requests.confirm(prompt, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(300_000);
  await expect(expired).resolves.toBe(false);
  const closing = requests.confirm(prompt, new AbortController().signal);
  await requests.dispose();
  await expect(closing).resolves.toBe(false);
  await expect(requests.confirm(prompt, new AbortController().signal)).resolves.toBe(false);
});

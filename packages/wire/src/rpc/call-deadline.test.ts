import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineContract, procedure } from '../api/define';
import { WireError } from '../api/protocol';
import { createTestWire } from '../testing';
import { forwardController } from './forward';

const contract = defineContract({
  /** Host work with no fixed bound, e.g. `git worktree add` on a large repository. */
  unbounded: procedure({ input: z.string(), output: z.string(), callTimeoutMs: 0 }),
  quick: procedure({ input: z.string(), output: z.string() }),
});

/** Handlers that settle only when the test finishes them, by input. */
function slowHandlers() {
  const finishers = new Map<string, () => void>();
  const settleLater = (input: string) =>
    new Promise<string>((resolve) => {
      finishers.set(input, () => resolve(`done ${input}`));
    });
  return {
    impl: { unbounded: settleLater, quick: settleLater },
    finish: (input: string) => finishers.get(input)?.(),
  };
}

async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true)
  );
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

describe('procedure call deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces the connection default with the procedure deadline', async () => {
    const handlers = slowHandlers();
    const wire = createTestWire(contract, handlers.impl);
    try {
      const unbounded = wire.client.unbounded('a');
      const quick = wire.client.quick('b').catch((error: unknown) => error);

      expect(await settledWithin(unbounded, 10 * 60_000)).toBe(false);
      expect(await quick).toMatchObject({ code: 'TIMEOUT' });

      handlers.finish('a');
      await expect(unbounded).resolves.toBe('done a');
    } finally {
      await wire.dispose();
    }
  });

  it('lets a per-call timeout override the procedure deadline', async () => {
    const wire = createTestWire(contract, slowHandlers().impl);
    try {
      const call = wire.client.unbounded('a', { timeoutMs: 5_000 }).catch((error) => error);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(await call).toMatchObject({ code: 'TIMEOUT' });
    } finally {
      await wire.dispose();
    }
  });

  it('still rejects a call without a deadline when the transport disconnects', async () => {
    const wire = createTestWire(contract, slowHandlers().impl);
    try {
      const call = wire.client.unbounded('a').catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);

      wire.pair.disconnect();

      const error = await call;
      expect(error).toBeInstanceOf(WireError);
      expect(error).toMatchObject({ code: 'DISCONNECTED' });
    } finally {
      await wire.dispose();
    }
  });

  it('keeps the procedure deadline across a forwarding hop', async () => {
    const handlers = slowHandlers();
    const worker = createTestWire(contract, handlers.impl);
    const server = createTestWire(contract, forwardController(contract, worker.client));
    try {
      const unbounded = server.client.unbounded('a');
      // The caller waits; the server's hop to the worker keeps its own 30s default.
      const quick = server.client.quick('b', { timeoutMs: 0 }).catch((error) => error);

      expect(await settledWithin(unbounded, 10 * 60_000)).toBe(false);
      expect(await quick).toMatchObject({ code: 'TIMEOUT' });

      handlers.finish('a');
      await expect(unbounded).resolves.toBe('done a');
    } finally {
      await server.dispose();
      await worker.dispose();
    }
  });
});

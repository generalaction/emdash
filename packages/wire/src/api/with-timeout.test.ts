import { ManualClock, deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTestWire } from '../testing';
import { compose } from '../util';
import { defineContract, procedure } from './define';
import { WireError } from './protocol';
import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  it('preserves context fields and aborts the derived signal on timeout', async () => {
    const clock = new ManualClock();
    const started = deferred<void>();
    let aborted = false;
    const spy = vi.fn();
    const handler = async (
      _input: { id: string },
      context: { signal?: AbortSignal; traceId: string }
    ) => {
      spy();
      expect(context.traceId).toBe('trace-1');
      context.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      started.resolve();
      await new Promise<never>(() => {});
    };
    const composed = compose(handler, [withTimeout({ timeoutMs: 5, clock })]);

    const result = composed({ id: 'same' }, { traceId: 'trace-1' });
    await started.promise;
    await clock.advanceBy(5);

    await expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(aborted).toBe(true);
  });

  it('does not fire after a successful handler completes', async () => {
    const clock = new ManualClock();
    const spy = vi.fn();
    const handler = async (_input: undefined, _context: { signal?: AbortSignal }) => {
      spy();
      return 'ok';
    };
    const composed = compose(handler, [withTimeout({ timeoutMs: 5, clock })]);

    await expect(composed(undefined, {})).resolves.toBe('ok');
    await clock.advanceBy(5);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('preserves caller cancellation instead of reporting timeout', async () => {
    const clock = new ManualClock();
    const abort = new AbortController();
    const reason = new Error('caller stopped');
    const started = deferred<void>();
    const handler = async (_input: undefined, context: { signal?: AbortSignal }) => {
      started.resolve();
      await new Promise<never>((_resolve, reject) => {
        context.signal?.addEventListener('abort', () => reject(context.signal?.reason), {
          once: true,
        });
      });
    };
    const composed = compose(handler, [withTimeout({ timeoutMs: 5, clock })]);

    const result = composed(undefined, { signal: abort.signal });
    await started.promise;
    abort.abort(reason);

    await expect(result).rejects.toBe(reason);
  });

  it('round-trips timeout failures through wire as TIMEOUT', async () => {
    const clock = new ManualClock();
    const slowContract = defineContract({
      slow: procedure({ input: z.void().optional(), output: z.void() }),
    });
    const started = deferred<void>();
    let aborted = false;
    const wire = createTestWire(slowContract, {
      slow: compose(
        async (_input, meta) => {
          meta.signal?.addEventListener('abort', () => {
            aborted = true;
          });
          started.resolve();
          await new Promise<never>(() => {});
        },
        [withTimeout({ timeoutMs: 10, clock })]
      ),
    });

    const result = wire.connection.call('slow', undefined);
    await started.promise;
    await clock.advanceBy(10);

    await expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(aborted).toBe(true);
    await wire.dispose();
  });

  it('keeps caller cancellation round-tripped as CANCELLED', async () => {
    const clock = new ManualClock();
    const slowContract = defineContract({
      slow: procedure({ input: z.void().optional(), output: z.void() }),
    });
    const started = deferred<void>();
    const wire = createTestWire(slowContract, {
      slow: compose(
        async (_input, meta) => {
          started.resolve();
          await new Promise<never>((_resolve, reject) => {
            meta.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          });
        },
        [withTimeout({ timeoutMs: 10, clock })]
      ),
    });
    const abort = new AbortController();

    const result = wire.connection.call('slow', undefined, { signal: abort.signal });
    await started.promise;
    abort.abort();

    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    await wire.dispose();
  });

  it('preserves existing wire errors', async () => {
    const handler = async (_input: undefined, _context: { signal?: AbortSignal }) => {
      throw new WireError('NOT_FOUND', 'missing');
    };
    const composed = compose(handler, [withTimeout({ timeoutMs: 5, clock: new ManualClock() })]);

    await expect(composed(undefined, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

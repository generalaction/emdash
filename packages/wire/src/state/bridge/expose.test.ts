import { ok } from '@emdash/shared';
import { createManualClock } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { liveModel, liveState, mutation } from '../../api';
import { cell, derived, flushStateTurn, read } from '../core';
import { query } from '../query';
import { settleAsync } from '../testing';
import { expose } from './expose';

const contract = liveModel({
  key: z.object({ id: z.string() }),
  states: {
    value: liveState({ data: z.object({ count: z.number() }) }),
  },
  mutations: {
    increment: mutation({
      input: z.object({ by: z.number() }),
      data: z.void(),
      error: z.never(),
    }),
  },
});

describe('state expose bridge', () => {
  it('waits for a cold query before resolving an acquired live source', async () => {
    const clock = createManualClock();
    const model = query({
      fetch: async () => ({ count: 1 }),
      debounceMs: 0,
      clock,
    });
    const provider = expose(contract, { value: model });
    const lease = provider.acquireState({ id: 'one' }, 'value');
    let ready = false;
    const readySource = lease.ready().then((source) => {
      ready = true;
      return source;
    });

    await settleAsync();
    expect(ready).toBe(false);

    await clock.advanceBy(0);
    const source = await readySource;
    expect((await source.snapshot()).data).toEqual({ count: 1 });

    await lease.release();
    await provider.dispose();
  });

  it('releases upstream query demand after the last lease lingers out', async () => {
    const clock = createManualClock();
    let count = 0;
    const provider = expose(
      contract,
      {
        value: (_key, scope) =>
          query({
            fetch: async () => {
              count += 1;
              return { count };
            },
            debounceMs: 0,
            revalidateEveryMs: 10,
            clock,
            scope,
          }),
      },
      { clock, lingerMs: 5 }
    );

    const lease = provider.acquireState({ id: 'one' }, 'value');
    await clock.advanceBy(0);
    await lease.ready();
    await lease.release();
    await clock.advanceBy(5);
    await clock.advanceBy(20);

    expect(count).toBe(1);
    await provider.dispose();
  });

  it('observes mutation revisions through a derived exposed state', async () => {
    const base = cell({ count: 0 });
    const value = derived(() => ({ count: read(base).count }));
    const provider = expose(
      contract,
      { value },
      {
        mutations: {
          async increment(context) {
            const revision = base.update(
              (previous) => ({ count: previous.count + context.input.by }),
              { mutationIds: [context.mutationId] }
            );
            await context.observed('value', revision);
            return ok<void>();
          },
        },
      }
    );
    const lease = provider.acquireState({ id: 'one' }, 'value');
    await lease.ready();

    const resultPromise = provider.runMutation('increment', {
      key: { id: 'one' },
      input: { by: 2 },
      mutationId: 'm1',
    });
    await settleAsync();
    flushStateTurn();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected mutation success');
    expect(result.data.cursors).toHaveLength(1);
    expect((await (await lease.ready()).snapshot()).data).toEqual({ count: 2 });

    await lease.release();
    await provider.dispose();
  });
});

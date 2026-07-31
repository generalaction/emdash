import { ok } from '@emdash/shared';
import { createManualClock } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineContract, liveModel, liveState, mutation } from '../../api';
import { createTestWire } from '../../testing';
import { cell, derived, flushStateTurn, read, snapshot } from '../core';
import { optimistic } from '../optimistic';
import { recordSnapshots, settleAsync } from '../testing';
import { expose } from './expose';
import { remote } from './remote';

const api = defineContract({
  counter: liveModel({
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
  }),
});

describe('state bridge round trip', () => {
  it('round-trips optimistic mutations without regressing before settlement', async () => {
    const key = { id: 'one' };
    const clock = createManualClock();
    const base = cell({ count: 0 });
    const exposedValue = derived(() => ({ count: read(base).count }));
    const provider = expose(
      api.counter,
      { value: exposedValue },
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
    const wire = createTestWire(api, { counter: provider });
    const model = remote(api.counter, wire.client.counter, {
      clock,
      lingerMs: 5,
    });
    const member = model(key);
    const view = optimistic(member.states.value);
    const recorded = recordSnapshots(view);

    expect(snapshot(member.states.value).status).toBe('loading');
    await waitForValue(() => snapshot(member.states.value).value?.count, 0);

    const result = await view.run(
      member.mutations.increment,
      { by: 1 },
      (draft, input) => {
        draft.count += input.by;
      }
    );
    await settleAsync();

    expect(result.success).toBe(true);
    expect(snapshot(view).value?.count).toBe(1);
    const values = recorded.snapshots.map((current) => current.value?.count);
    const firstOptimisticValue = values.indexOf(1);
    expect(firstOptimisticValue).toBeGreaterThanOrEqual(0);
    expect(values.slice(firstOptimisticValue)).not.toContain(0);

    await recorded.dispose();
    await clock.advanceBy(5);
    expect(model.peekMember(key)).toBeUndefined();

    await model.dispose();
    await wire.dispose();
    await provider.dispose();
  });
});

async function waitForValue<T>(readValue: () => T, expected: T): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await settleAsync();
    flushStateTurn();
    if (Object.is(readValue(), expected)) return;
  }
  expect(readValue()).toBe(expected);
}

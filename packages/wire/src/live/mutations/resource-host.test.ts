import { err, ok, type PendingLease } from '@emdash/shared';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { defineContract, liveModel, liveState, mutation } from '../../api';
import { LiveState } from '../state';
import { createResourceLiveModelHost } from './resource-host';

function pending<T>(value: T, release = vi.fn(async () => {})): PendingLease<T> {
  return { ready: async () => value, release };
}

const contract = defineContract({
  counter: liveModel({
    key: z.object({ id: z.string() }),
    states: { value: liveState({ data: z.object({ count: z.number() }) }) },
    mutations: {
      add: mutation({
        input: z.object({ amount: z.number() }),
        data: z.number(),
        error: z.object({ type: z.literal('unavailable') }),
      }),
    },
  }),
});

describe('createResourceLiveModelHost', () => {
  it('retains a resource for the full state lease', async () => {
    const state = new LiveState({ count: 1 });
    const release = vi.fn(async () => {});
    const host = createResourceLiveModelHost(contract.counter, {
      acquire: () => pending({ state }, release),
      states: { value: ({ resource }) => resource.state },
      mutations: { add: () => ok(0) },
    });

    const lease = host.acquireState({ id: 'one' }, 'value');
    await expect(lease.ready()).resolves.toBe(state);
    expect(release).not.toHaveBeenCalled();

    await lease.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases a nested state before its parent resource', async () => {
    const releases: string[] = [];
    const state = new LiveState({ count: 1 });
    const host = createResourceLiveModelHost(contract.counter, {
      acquire: () =>
        pending(
          {},
          vi.fn(async () => {
            releases.push('resource');
          })
        ),
      states: {
        value: () =>
          pending(
            state,
            vi.fn(async () => {
              releases.push('state');
            })
          ),
      },
      mutations: { add: () => ok(0) },
    });

    const lease = host.acquireState({ id: 'one' }, 'value');
    await lease.ready();
    await lease.release();

    expect(releases).toEqual(['state', 'resource']);
  });

  it('provides exact mutation types and captures settled cursors', async () => {
    const state = new LiveState({ count: 1 });
    const release = vi.fn(async () => {});
    const host = createResourceLiveModelHost(contract.counter, {
      acquire: () => pending({ state }, release),
      states: { value: ({ resource }) => resource.state },
      mutations: {
        add: async (context) => {
          expectTypeOf(context.input).toEqualTypeOf<{ amount: number }>();
          expectTypeOf(context.resource).toEqualTypeOf<{ state: LiveState<{ count: number }> }>();
          const cursor = context.resource.state.produce((draft) => {
            draft.count += context.input.amount;
          });
          await context.settle('value', cursor);
          return ok(context.input.amount);
        },
      },
    });

    const result = await host.runMutation('add', {
      key: { id: 'one' },
      input: { amount: 2 },
      mutationId: 'mutation-1',
    });

    expect(result).toEqual({
      success: true,
      data: {
        data: 2,
        cursors: [
          {
            model: 'counter.value',
            key: { id: 'one' },
            cursor: { generation: expect.any(Number), sequence: 1 },
          },
        ],
      },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('deduplicates mutation ids', async () => {
    const run = vi.fn(() => ok(1));
    const host = createResourceLiveModelHost(contract.counter, {
      acquire: () => pending({}),
      states: { value: () => new LiveState({ count: 1 }) },
      mutations: { add: run },
    });
    const envelope = { key: { id: 'one' }, input: { amount: 1 }, mutationId: 'same' };

    await expect(
      Promise.all([host.runMutation('add', envelope), host.runMutation('add', envelope)])
    ).resolves.toHaveLength(2);
    expect(run).toHaveBeenCalledOnce();
  });

  it('maps only recognized acquisition errors and still releases', async () => {
    const expected = { type: 'resource-missing' };
    const release = vi.fn(async () => {});
    const host = createResourceLiveModelHost(contract.counter, {
      acquire: () => ({
        ready: async () => Promise.reject(expected),
        release,
      }),
      states: { value: () => new LiveState({ count: 0 }) },
      mutations: { add: () => ok(0) },
      toMutationError: (_name, error) =>
        error === expected ? { type: 'unavailable' as const } : undefined,
    });

    await expect(
      host.runMutation('add', {
        key: { id: 'missing' },
        input: { amount: 1 },
        mutationId: 'missing',
      })
    ).resolves.toEqual(err({ type: 'unavailable' }));
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps unexpected handler failures thrown and releases the resource', async () => {
    const release = vi.fn(async () => {});
    const host = createResourceLiveModelHost(contract.counter, {
      acquire: () => pending({}, release),
      states: { value: () => new LiveState({ count: 0 }) },
      mutations: {
        add: () => {
          throw new TypeError('bug');
        },
      },
    });

    await expect(
      host.runMutation('add', {
        key: { id: 'one' },
        input: { amount: 1 },
        mutationId: 'bug',
      })
    ).rejects.toThrow(new TypeError('bug'));
    expect(release).toHaveBeenCalledOnce();
  });

  it('supports mutation-free resource models without a fake handler', async () => {
    const statesOnly = defineContract({
      model: liveModel({
        key: z.object({ id: z.string() }),
        states: { value: liveState({ data: z.number() }) },
        mutations: {},
      }),
    });
    const host = createResourceLiveModelHost(statesOnly.model, {
      acquire: () => pending({ state: new LiveState(1) }),
      states: { value: ({ resource }) => resource.state },
    });

    const lease = host.acquireState({ id: 'one' }, 'value');
    await expect(lease.ready()).resolves.toBeTruthy();
    await lease.release();
  });
});

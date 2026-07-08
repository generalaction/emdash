import { err, ok, type PendingLease } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  bindContract,
  client,
  connect,
  createLiveModelReplica,
  createLiveModelHost,
  defineContract,
  defineLiveModelContract,
  memoryTransportPair,
  mutation,
  serve,
} from '../../index';
import type { ReplicaInstance } from '../../live/replica';
import { OptimisticLiveModelGroup } from './optimistic-group';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ title: z.string() });
const usageSchema = z.object({ tokens: z.number() });
const titleInputSchema = z.object({ title: z.string() });

type TestApi = ReturnType<typeof createTestApi>;

describe('OptimisticLiveModelGroup', () => {
  it('previews multi-member group mutations and confirms without double-applying', async () => {
    const api = createTestApi();
    const { group } = setup(api);

    await group.ready;
    const invocation = group.mutations.setTitle({ title: 'Wire' });

    expect(group.values.state).toEqual({ title: 'Wire' });
    expect(group.values.usage).toEqual({ tokens: 4 });
    expect(group.isPending).toBe(true);

    const result = await invocation;
    expect(result.result.success ? result.result.data.data : undefined).toEqual({ title: 'Wire' });
    await result.settled;
    await waitFor(() => !group.isPending);

    expect(group.values.state).toEqual({ title: 'Wire' });
    expect(group.values.usage).toEqual({ tokens: 4 });
    await group.dispose();
  });

  it('rolls back overlays when the authoritative mutation returns an error', async () => {
    const api = createTestApi({
      failOnAuthoritativeMutation: 'serverError',
    });
    const { group } = setup(api);

    await group.ready;
    const invocation = group.mutations.serverError({ title: 'Preview' });

    expect(group.values.state).toEqual({ title: 'Preview' });
    expect(group.values.usage).toEqual({ tokens: 7 });

    const result = await invocation;
    expect(result.result).toEqual(err('server-error'));
    expect(group.values.state).toEqual({ title: 'Initial' });
    expect(group.values.usage).toEqual({ tokens: 0 });
    expect(group.isPending).toBe(false);
    await group.dispose();
  });

  it('rolls back overlays when the authoritative mutation throws', async () => {
    const api = createTestApi({
      throwOnAuthoritativeMutation: 'serverThrow',
    });
    const { group } = setup(api);

    await group.ready;
    const invocation = group.mutations.serverThrow({ title: 'Preview' });

    expect(group.values.state).toEqual({ title: 'Preview' });
    await expect(invocation).rejects.toThrow('server-throw');
    expect(group.values.state).toEqual({ title: 'Initial' });
    expect(group.values.usage).toEqual({ tokens: 0 });
    expect(group.isPending).toBe(false);
    await group.dispose();
  });

  it('does not commit overlays when the local handler throws', async () => {
    const api = createTestApi({
      throwOnLocalMutation: 'localThrow',
    });
    const { group } = setup(api);

    await group.ready;
    const invocation = group.mutations.localThrow({ title: 'Preview' });

    expect(group.values.state).toEqual({ title: 'Initial' });
    expect(group.values.usage).toEqual({ tokens: 0 });
    const result = await invocation;
    expect(result.result.success ? result.result.data.data : undefined).toEqual({
      title: 'Preview',
    });
    await result.settled;
    expect(group.values.state).toEqual({ title: 'Preview' });
    expect(group.isPending).toBe(false);
    await group.dispose();
  });

  it('clears pending overlays when a seed/resync lands', async () => {
    const api = createTestApi();
    const captured: Record<string, (value: unknown, meta: { kind: 'seed' }) => void> = {};
    const group = new OptimisticLiveModelGroup(
      api.conversation,
      { id: 'demo' },
      (key, onChange) => {
        captured['state'] = onChange?.state as (value: unknown, meta: { kind: 'seed' }) => void;
        captured['usage'] = onChange?.usage as (value: unknown, meta: { kind: 'seed' }) => void;
        captured['state']({ title: 'Initial' }, { kind: 'seed' });
        captured['usage']({ tokens: 0 }, { kind: 'seed' });
        return leaseFor({
          key,
          models: {
            state: stubReplicaModel(),
            usage: stubReplicaModel(),
          },
          mutations: {
            setTitle: async () => pendingInvocation(),
            serverError: async () => pendingInvocation(),
            serverThrow: async () => pendingInvocation(),
            localThrow: async () => pendingInvocation(),
          },
          ready: Promise.resolve(),
        } as never);
      }
    );

    await group.ready;
    void group.mutations.setTitle({ title: 'Preview' });
    expect(group.values.state).toEqual({ title: 'Preview' });
    expect(group.isPending).toBe(true);

    captured['state']({ title: 'Resynced' }, { kind: 'seed' });
    captured['usage']({ tokens: 10 }, { kind: 'seed' });

    expect(group.values.state).toEqual({ title: 'Resynced' });
    expect(group.values.usage).toEqual({ tokens: 10 });
    expect(group.isPending).toBe(false);
    await group.dispose();
  });

  it('composes concurrent optimistic mutations in insertion order', async () => {
    const api = createTestApi();
    const group = createFakePendingGroup(api);

    await group.ready;
    void group.mutations.setTitle({ title: 'A' });
    void group.mutations.setTitle({ title: 'BB' });

    expect(group.values.state).toEqual({ title: 'BB' });
    expect(group.values.usage).toEqual({ tokens: 3 });
    expect(group.isPending).toBe(true);
    await group.dispose();
  });
});

function createTestApi(
  options: {
    failOnAuthoritativeMutation?: string;
    throwOnAuthoritativeMutation?: string;
    throwOnLocalMutation?: string;
    delayAuthoritativeMutations?: Array<Deferred<void>>;
  } = {}
) {
  return defineContract({
    conversation: defineLiveModelContract({
      key: keySchema,
      models: {
        state: stateSchema,
        usage: usageSchema,
      },
      mutations: {
        setTitle: titleMutation('setTitle'),
        serverError: titleMutation('serverError'),
        serverThrow: titleMutation('serverThrow'),
        localThrow: titleMutation('localThrow'),
      },
    }),
  });

  function titleMutation(name: string) {
    return mutation(
      { input: titleInputSchema, data: stateSchema, error: z.string() },
      (ctx, input) => {
        const isServerCall = typeof (ctx as { cursors?: unknown }).cursors === 'function';
        const isLocalCall = !isServerCall;

        if (isLocalCall && options.throwOnLocalMutation === name) {
          throw new Error('local-throw');
        }
        if (!isLocalCall && options.throwOnAuthoritativeMutation === name) {
          throw new Error('server-throw');
        }
        if (!isLocalCall && options.failOnAuthoritativeMutation === name) {
          return err('server-error');
        }
        if (!isLocalCall && options.delayAuthoritativeMutations) {
          const gate = deferred<void>();
          options.delayAuthoritativeMutations.push(gate);
          return gate.promise.then(() => applyTitle(ctx, input.title));
        }

        return applyTitle(ctx, input.title);
      }
    );
  }
}

function applyTitle(
  ctx: {
    produce(name: 'state' | 'usage', mutator: (draft: unknown) => void): void;
  },
  title: string
) {
  ctx.produce('state', (draft) => {
    (draft as { title: string }).title = title;
  });
  ctx.produce('usage', (draft) => {
    (draft as { tokens: number }).tokens += title.length;
  });
  return ok({ title });
}

function setup(api: TestApi): {
  group: OptimisticLiveModelGroup<TestApi['conversation']>;
} {
  const key = { id: 'demo' };
  const conversations = createLiveModelHost(api.conversation);
  conversations.create(key, {
    state: { title: 'Initial' },
    usage: { tokens: 0 },
  });

  const pair = memoryTransportPair();
  const controller = bindContract(api, { conversation: conversations });
  serve(pair.right, controller);
  const thin = client(api, connect(pair.left));
  const group = new OptimisticLiveModelGroup(api.conversation, key, (groupKey, onChange) => {
    const replica = createLiveModelReplica(api.conversation, thin.conversation, {
      onChange: onChange as never,
    });
    const lease = replica.acquire(groupKey);
    return {
      ready: () => lease.ready(),
      release: async () => {
        await lease.release();
        await replica.dispose();
      },
    };
  });
  return { group };
}

function createFakePendingGroup(api: TestApi): OptimisticLiveModelGroup<TestApi['conversation']> {
  return new OptimisticLiveModelGroup(api.conversation, { id: 'demo' }, (_key, onChange) => {
    onChange?.state?.({ title: 'Initial' }, { kind: 'seed' });
    onChange?.usage?.({ tokens: 0 }, { kind: 'seed' });
    return leaseFor({
      key: _key,
      models: {
        state: stubReplicaModel(),
        usage: stubReplicaModel(),
      },
      mutations: {
        setTitle: async () => pendingInvocation(),
        serverError: async () => pendingInvocation(),
        serverThrow: async () => pendingInvocation(),
        localThrow: async () => pendingInvocation(),
      },
      ready: Promise.resolve(),
    } as never);
  });
}

function stubReplicaModel() {
  return {
    ready: Promise.resolve(),
    current: () => undefined,
  };
}

function leaseFor<Group extends ReplicaInstance>(instance: Group): PendingLease<Group> {
  return {
    ready: async () => instance,
    release: async () => {},
  };
}

function pendingInvocation(): Promise<never> {
  return new Promise(() => {});
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

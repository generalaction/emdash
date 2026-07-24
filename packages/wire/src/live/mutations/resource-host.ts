import {
  err,
  ok,
  toPendingLease,
  type Lease,
  type PendingLease,
  type Result,
} from '@emdash/shared';
import type {
  LiveModelKey,
  LiveModelMutations,
  LiveModelDef,
  LiveModelStates,
  MutationData,
  MutationError,
  MutationInput,
} from '../../api/define';
import { WireError } from '../../api/protocol';
import type { WireInstrumentation } from '../../observability';
import type { LiveCursor, LiveCursorEntry, LiveSource } from '../protocol';
import type { LeasedLiveModelProvider } from '../replica/leased-provider';
import { MutationResultCache, type MutationResultCacheOptions } from './result-cache';
import type { LiveMutationResult } from './types';

type MaybePromise<T> = T | Promise<T>;

export type ResourceStateName<Group extends LiveModelDef> = Extract<
  keyof LiveModelStates<Group>,
  string
>;

export type ResourceMutationName<Group extends LiveModelDef> = Extract<
  keyof LiveModelMutations<Group>,
  string
>;

export type ResourceStateBindings<Group extends LiveModelDef, Resource> = {
  [Name in ResourceStateName<Group>]: (context: {
    resource: Resource;
    key: LiveModelKey<Group>;
    name: Name;
  }) => MaybePromise<LiveSource | PendingLease<LiveSource>>;
};

export type ResourceMutationContext<
  Group extends LiveModelDef,
  Resource,
  Name extends ResourceMutationName<Group>,
> = Readonly<{
  resource: Resource;
  key: LiveModelKey<Group>;
  input: MutationInput<LiveModelMutations<Group>[Name]>;
  mutationId: string;
  settle<StateName extends ResourceStateName<Group>>(
    name: StateName,
    cursor: LiveCursor | Promise<LiveCursor>
  ): Promise<void>;
}>;

export type ResourceMutationHandlers<Group extends LiveModelDef, Resource> = {
  [Name in ResourceMutationName<Group>]: (
    context: ResourceMutationContext<Group, Resource, Name>
  ) => MaybePromise<
    Result<
      MutationData<LiveModelMutations<Group>[Name]>,
      MutationError<LiveModelMutations<Group>[Name]>
    >
  >;
};

type ResourceMutationError<Group extends LiveModelDef> = {
  [Name in ResourceMutationName<Group>]: MutationError<LiveModelMutations<Group>[Name]>;
}[ResourceMutationName<Group>];

type ResourceHostBaseOptions<Group extends LiveModelDef, Resource> = Readonly<{
  acquire(key: LiveModelKey<Group>): PendingLease<Resource>;
  states: ResourceStateBindings<Group, Resource>;
  idempotency?: MutationResultCacheOptions | false;
  instrumentation?: WireInstrumentation;
  toMutationError?(
    name: ResourceMutationName<Group>,
    error: unknown
  ): ResourceMutationError<Group> | undefined;
  dispose?(): Promise<void>;
}>;

export type ResourceLiveModelHostOptions<
  Group extends LiveModelDef,
  Resource,
> = ResourceHostBaseOptions<Group, Resource> &
  ([ResourceMutationName<Group>] extends [never]
    ? { mutations?: never }
    : { mutations: ResourceMutationHandlers<Group, Resource> });

export type ResourceLiveModelHost<Group extends LiveModelDef = LiveModelDef> =
  LeasedLiveModelProvider<Group>;

/** A live-model provider for lazily acquired, externally authoritative resources. */
export function createResourceLiveModelHost<Group extends LiveModelDef, Resource>(
  contract: Group,
  options: ResourceLiveModelHostOptions<NoInfer<Group>, Resource>
): ResourceLiveModelHost<Group> {
  const mutationCache =
    options.idempotency === false ? undefined : new MutationResultCache(options.idempotency);
  let disposed = false;

  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState(key, name) {
      assertActive();
      return acquireResourceState(key, name);
    },
    runMutation(name, envelope) {
      assertActive();
      const execute = () => executeMutation(name, envelope);
      if (!mutationCache) return execute();
      return mutationCache.run(envelope.mutationId, execute, {
        onDedupe: () =>
          options.instrumentation?.mutationDeduped?.({
            mutationId: envelope.mutationId,
            path: `${contract.id}.${String(name)}`,
          }),
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      mutationCache?.clear();
      await options.dispose?.();
    },
  };

  function acquireResourceState<Name extends ResourceStateName<Group>>(
    key: LiveModelKey<Group>,
    name: Name
  ): PendingLease<LiveSource> {
    return toPendingLease(
      (async (): Promise<Lease<LiveSource>> => {
        let resourceLease: PendingLease<Resource> | undefined;
        let stateLease: PendingLease<LiveSource> | undefined;
        try {
          resourceLease = options.acquire(key);
          const resource = await resourceLease.ready();
          const parentLease = resourceLease;
          const acquired = await options.states[name]({ resource, key, name });
          if (isPendingLease(acquired)) {
            stateLease = acquired;
            return {
              value: await stateLease.ready(),
              release: () => releaseStateAndResource(stateLease, parentLease),
            };
          }
          return { value: acquired, release: () => parentLease.release() };
        } catch (error) {
          await releaseStateAndResource(stateLease, resourceLease);
          throw error;
        }
      })()
    );
  }

  async function executeMutation<Name extends ResourceMutationName<Group>>(
    name: Name,
    envelope: {
      key: LiveModelKey<Group>;
      input: MutationInput<LiveModelMutations<Group>[Name]>;
      mutationId: string;
    }
  ): Promise<
    LiveMutationResult<
      MutationData<LiveModelMutations<Group>[Name]>,
      MutationError<LiveModelMutations<Group>[Name]>
    >
  > {
    let resourceLease: PendingLease<Resource>;
    try {
      resourceLease = options.acquire(envelope.key);
    } catch (error) {
      return acquisitionFailure(name, error);
    }

    try {
      let resource: Resource;
      try {
        resource = await resourceLease.ready();
      } catch (error) {
        return acquisitionFailure(name, error);
      }

      const handler = options.mutations?.[name];
      if (!handler) {
        throw new WireError(
          'MISSING_HANDLER',
          `Mutation '${contract.id}.${String(name)}' requires a handler`
        );
      }

      const cursors = new Map<string, LiveCursorEntry>();
      const settlements: Promise<void>[] = [];
      const context: ResourceMutationContext<Group, Resource, Name> = {
        resource,
        key: envelope.key,
        input: envelope.input,
        mutationId: envelope.mutationId,
        settle(stateName, cursor) {
          const settlement = Promise.resolve(cursor).then((resolved) => {
            const state = contract.states[stateName];
            const current = cursors.get(state.id);
            if (current && compareCursor(current.cursor, resolved) >= 0) return;
            cursors.set(state.id, {
              model: state.id,
              key: envelope.key,
              cursor: resolved,
            });
          });
          settlements.push(settlement);
          return settlement;
        },
      };
      const result = await handler(context);
      await Promise.all(settlements);
      return result.success ? ok({ data: result.data, cursors: [...cursors.values()] }) : result;
    } finally {
      await resourceLease.release();
    }
  }

  function acquisitionFailure<Name extends ResourceMutationName<Group>>(
    name: Name,
    error: unknown
  ): LiveMutationResult<
    MutationData<LiveModelMutations<Group>[Name]>,
    MutationError<LiveModelMutations<Group>[Name]>
  > {
    const expected = options.toMutationError?.(name, error);
    if (expected !== undefined) {
      return err(expected as MutationError<LiveModelMutations<Group>[Name]>);
    }
    throw error;
  }

  function assertActive(): void {
    if (disposed) throw new Error(`ResourceLiveModelHost '${contract.id}' is disposed`);
  }
}

async function releaseStateAndResource<Resource>(
  state: PendingLease<LiveSource> | undefined,
  resource: PendingLease<Resource> | undefined
): Promise<void> {
  try {
    await state?.release();
  } finally {
    await resource?.release();
  }
}

function isPendingLease(
  value: LiveSource | PendingLease<LiveSource>
): value is PendingLease<LiveSource> {
  return 'ready' in value && typeof value.ready === 'function';
}

function compareCursor(left: LiveCursor, right: LiveCursor): number {
  if (left.generation !== right.generation) return left.generation - right.generation;
  return left.sequence - right.sequence;
}

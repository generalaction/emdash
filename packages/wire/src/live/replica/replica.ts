import type { PendingLease } from '@emdash/shared';
import type {
  MutationCallOptions,
  LiveModelClientHandle,
  LiveClientHandle,
} from '../../api/client';
import type { LiveModelKey, LiveModelDef, MutationData, MutationError } from '../../api/define';
import { createManagedSource } from '../../util/managed-source';
import { stableStringify, type LiveMutationResult } from '../mutations';
import type { LiveSource } from '../protocol';
import type { LiveChangeMeta } from '../state';
import {
  buildReplicaInstance,
  translateCursors,
  type ReplicaInstance,
  type ReplicaInstanceOptions,
} from './instance';
import type { LiveModelProvider } from './provider';
import { managedLiveSource } from './source';
import { ReplicaState } from './state';
import type { StateStore } from './store';

export type LiveModelReplicaOptions<Group extends LiveModelDef = LiveModelDef> =
  ReplicaInstanceOptions<Group> & {
    retentionMs?: number;
  };

export type LiveModelReplica<Group extends LiveModelDef = LiveModelDef> =
  LiveModelProvider<Group> & {
    readonly replica: true;
    acquire(key: LiveModelKey<Group>): PendingLease<ReplicaInstance<Group>>;
    peek(key: LiveModelKey<Group>): ReplicaInstance<Group> | undefined;
    dispose(): Promise<void>;
  };

export function createLiveModelReplica<Group extends LiveModelDef>(
  contract: Group,
  group: LiveModelClientHandle<Group>,
  options: LiveModelReplicaOptions<Group> = {}
): LiveModelReplica<Group> {
  const source = createManagedSource<LiveModelKey<Group>, ReplicaInstance<Group>>({
    key: stableStringify,
    graceMs: options.retentionMs,
    async create(key, scope) {
      const instance = buildReplicaInstance(contract, key, {
        createState(name, model) {
          const stateName = name as keyof Group['states'];
          const replica = new ReplicaState(
            group.state(key, name as never) as LiveClientHandle<unknown>,
            {
              instrumentation: options.instrumentation,
              logger: options.logger,
              onChange: options.onChange?.[stateName] as
                | ((value: unknown, meta: LiveChangeMeta) => void)
                | undefined,
              schema: model.dataSchema,
              store: options.stores?.[stateName]?.() as StateStore<unknown> | undefined,
            }
          );
          scope.add(() => replica.dispose());
          return replica;
        },
        mutate(name, envelope) {
          return runReplicaMutation(name, envelope);
        },
      });
      await instance.ready;
      return instance;
    },
  });

  return {
    kind: 'liveModelProvider',
    replica: true,
    contract,
    acquire(key) {
      return source.acquire(key);
    },
    peek(key) {
      return source.peek(key);
    },
    resolveState(key, name) {
      return managedLiveSource(source, key, (instance) => stateFor(instance, name));
    },
    async runMutation(name, envelope) {
      return runReplicaMutation(name, envelope);
    },
    dispose() {
      return source.dispose();
    },
  };

  async function runReplicaMutation<Name extends Extract<keyof Group['mutations'], string>>(
    name: Name,
    envelope: {
      key: LiveModelKey<Group>;
      input: unknown;
      mutationId: string;
    }
  ): Promise<
    LiveMutationResult<
      MutationData<Group['mutations'][Name]>,
      MutationError<Group['mutations'][Name]>
    >
  > {
    const lease = source.acquire(envelope.key);
    try {
      const instance = await lease.ready();
      const result = (await group.mutate(
        name as never,
        {
          key: envelope.key,
          input: envelope.input as never,
          mutationId: envelope.mutationId,
        },
        { mutationId: envelope.mutationId } satisfies MutationCallOptions
      )) as LiveMutationResult<
        MutationData<Group['mutations'][Name]>,
        MutationError<Group['mutations'][Name]>
      >;
      if (!result.success) return result;
      const cursors = await translateCursors(instance, contract, result.data.cursors);
      return {
        success: true,
        data: {
          ...result.data,
          cursors,
        },
      };
    } finally {
      await lease.release();
    }
  }
}

export function isLiveModelReplica(value: unknown): value is LiveModelReplica {
  return (
    typeof value === 'object' && value !== null && (value as { replica?: unknown }).replica === true
  );
}

function stateFor(instance: ReplicaInstance, name: string): LiveSource {
  const model = instance.states[name];
  if (!model) throw new Error(`Unknown replica model '${name}'`);
  return model;
}

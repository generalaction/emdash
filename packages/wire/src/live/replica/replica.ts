import type { PendingLease } from '@emdash/shared';
import type { MutationCallOptions, ThinGroup, ThinLiveHandle } from '../../api/client';
import type { GroupKey, LiveModelGroupDef, MutationData, MutationError } from '../../api/define';
import { createManagedSource } from '../../util/managed-source';
import { stableStringify, type LiveMutationResult } from '../mutations';
import type { LiveSource } from '../protocol';
import {
  buildReplicaInstance,
  translateCursors,
  type ReplicaInstance,
  type ReplicaInstanceOptions,
} from './instance';
import { ReplicaModel } from './model';
import type { LiveModelProvider } from './provider';
import { managedLiveSource } from './source';

export type LiveModelReplicaOptions = ReplicaInstanceOptions & {
  retentionMs?: number;
};

export type LiveModelReplica<Group extends LiveModelGroupDef = LiveModelGroupDef> =
  LiveModelProvider<Group> & {
    readonly replica: true;
    acquire(key: GroupKey<Group>): PendingLease<ReplicaInstance<Group>>;
    peek(key: GroupKey<Group>): ReplicaInstance<Group> | undefined;
    dispose(): Promise<void>;
  };

export function createLiveModelReplica<Group extends LiveModelGroupDef>(
  contract: Group,
  group: ThinGroup<Group>,
  options: LiveModelReplicaOptions = {}
): LiveModelReplica<Group> {
  const source = createManagedSource<GroupKey<Group>, ReplicaInstance<Group>>({
    key: stableStringify,
    graceMs: options.retentionMs,
    async create(key, scope) {
      const instance = buildReplicaInstance(contract, key, {
        createModel(name, model) {
          const replica = new ReplicaModel(
            group.model(key, name as never) as ThinLiveHandle<unknown>,
            {
              instrumentation: options.instrumentation,
              logger: options.logger,
              onChange: options.onChange?.[name],
              schema: model.dataSchema,
              store: options.store?.(name),
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
    resolveModel(key, name) {
      return managedLiveSource(source, key, (instance) => modelFor(instance, name));
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
      key: GroupKey<Group>;
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

function modelFor(instance: ReplicaInstance, name: string): LiveSource {
  const model = instance.models[name];
  if (!model) throw new Error(`Unknown replica model '${name}'`);
  return model;
}

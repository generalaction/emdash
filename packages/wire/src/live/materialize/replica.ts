import type { Unsubscribe } from '@emdash/shared';
import type { ThinGroup } from '../../api/client';
import type { GroupKey, LiveModelGroupDef, MutationData, MutationError } from '../../api/define';
import { createManagedSource } from '../../util/managed-source';
import { stableStringify, type LiveMutationResult } from '../mutations';
import type { LiveCursorEntry, LiveSource, LiveUpdate } from '../protocol';
import { MaterializedModel } from './model';
import type { LiveModelGroupProvider } from './provider';
import type { StateStore } from './store';

export type LiveModelReplicaOptions = {
  retentionMs?: number;
  store?: (modelName: string) => StateStore<unknown>;
};

export type LiveModelReplica<Group extends LiveModelGroupDef = LiveModelGroupDef> =
  LiveModelGroupProvider<Group> & {
    readonly replica: true;
    dispose(): Promise<void>;
  };

type ReplicaInstance = {
  models: Record<string, MaterializedModel<unknown>>;
};

export function createLiveModelReplica<Group extends LiveModelGroupDef>(
  contract: Group,
  group: ThinGroup<Group>,
  options: LiveModelReplicaOptions = {}
): LiveModelReplica<Group> {
  const source = createManagedSource<GroupKey<Group>, ReplicaInstance>({
    key: stableStringify,
    graceMs: options.retentionMs,
    async create(key, scope) {
      const models: Record<string, MaterializedModel<unknown>> = {};
      for (const [name, model] of Object.entries(contract.models)) {
        const materialized = new MaterializedModel(group.model(key, name as never) as never, {
          schema: model.dataSchema,
          store: options.store?.(name),
        });
        scope.add(() => materialized.dispose());
        models[name] = materialized;
      }
      await Promise.all(Object.values(models).map((model) => model.ready));
      return { models };
    },
  });

  return {
    kind: 'liveModelGroupProvider',
    replica: true,
    contract,
    resolveModel(key, name) {
      return lazyReplicaSource(source, key, name);
    },
    async runMutation(name, envelope) {
      const lease = await source.acquire(envelope.key);
      try {
        const instance = await lease.ready();
        const result = (await group.mutate(
          name,
          {
            key: envelope.key,
            input: envelope.input,
            mutationId: envelope.mutationId,
          },
          { mutationId: envelope.mutationId }
        )) as LiveMutationResult<
          MutationData<Group['mutations'][typeof name]>,
          MutationError<Group['mutations'][typeof name]>
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
    },
    dispose() {
      return source.dispose();
    },
  };
}

export function isLiveModelReplica(value: unknown): value is LiveModelReplica {
  return (
    typeof value === 'object' && value !== null && (value as { replica?: unknown }).replica === true
  );
}

function lazyReplicaSource<Group extends LiveModelGroupDef>(
  source: ReturnType<typeof createManagedSource<GroupKey<Group>, ReplicaInstance>>,
  key: GroupKey<Group>,
  modelName: string
): LiveSource {
  return {
    async snapshot() {
      const lease = await source.acquire(key);
      try {
        return await modelFor(await lease.ready(), modelName).snapshot();
      } finally {
        await lease.release();
      }
    },
    subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
      let disposed = false;
      let unsubscribe: Unsubscribe | undefined;
      const leasePromise = source.acquire(key);
      void leasePromise.ready().then((instance) => {
        if (disposed) {
          void leasePromise.release();
          return;
        }
        unsubscribe = modelFor(instance, modelName).subscribe(cb);
      });
      return () => {
        disposed = true;
        unsubscribe?.();
        void leasePromise.release();
      };
    },
  };
}

async function translateCursors(
  instance: ReplicaInstance,
  contract: LiveModelGroupDef,
  cursors: LiveCursorEntry[]
): Promise<LiveCursorEntry[]> {
  const translated: LiveCursorEntry[] = [];
  for (const entry of cursors) {
    const modelName = modelNameForCursor(contract, entry);
    const model = modelName ? instance.models[modelName] : undefined;
    if (!model) {
      translated.push(entry);
      continue;
    }
    await model.waitForCursor(entry.cursor);
    translated.push({
      ...entry,
      cursor: model.localCursorFor(entry.cursor),
    });
  }
  return translated;
}

function modelNameForCursor(group: LiveModelGroupDef, entry: LiveCursorEntry): string | undefined {
  for (const [name, model] of Object.entries(group.models)) {
    if (model.id === entry.model) return name;
  }
  return undefined;
}

function modelFor(instance: ReplicaInstance, name: string): MaterializedModel<unknown> {
  const model = instance.models[name];
  if (!model) throw new Error(`Unknown replica model '${name}'`);
  return model;
}

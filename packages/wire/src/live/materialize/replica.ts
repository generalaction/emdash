import type { PendingLease, Unsubscribe } from '@emdash/shared';
import type { MutationCallOptions, ThinGroup, ThinLiveHandle } from '../../api/client';
import type { GroupKey, LiveModelGroupDef, MutationData, MutationError } from '../../api/define';
import { createManagedSource } from '../../util/managed-source';
import { createMutationId } from '../mutations';
import { stableStringify, type LiveMutationResult } from '../mutations';
import type { LiveCursorEntry, LiveSource, LiveUpdate } from '../protocol';
import type {
  ContractMutationInvocation,
  MaterializedModels,
  MaterializedMutations,
} from './instance';
import { MaterializedModel } from './model';
import type { LiveModelGroupProvider } from './provider';
import type { StateStore } from './store';

export type LiveModelReplicaOptions = {
  retentionMs?: number;
  store?: (modelName: string) => StateStore<unknown>;
};

export type LiveModelReplicaInstance<Group extends LiveModelGroupDef = LiveModelGroupDef> = {
  readonly key: GroupKey<Group>;
  readonly models: MaterializedModels<Group>;
  readonly mutations: MaterializedMutations<Group>;
  readonly ready: Promise<void>;
};

export type LiveModelReplica<Group extends LiveModelGroupDef = LiveModelGroupDef> =
  LiveModelGroupProvider<Group> & {
    readonly replica: true;
    acquire(key: GroupKey<Group>): PendingLease<LiveModelReplicaInstance<Group>>;
    peek(key: GroupKey<Group>): LiveModelReplicaInstance<Group> | undefined;
    dispose(): Promise<void>;
  };

export function createLiveModelReplica<Group extends LiveModelGroupDef>(
  contract: Group,
  group: ThinGroup<Group>,
  options: LiveModelReplicaOptions = {}
): LiveModelReplica<Group> {
  const source = createManagedSource<GroupKey<Group>, LiveModelReplicaInstance<Group>>({
    key: stableStringify,
    graceMs: options.retentionMs,
    async create(key, scope) {
      return createReplicaInstance(
        contract,
        group,
        key,
        scope.add.bind(scope),
        options,
        (name, input) => runReplicaMutation(name, input)
      );
    },
  });

  return {
    kind: 'liveModelGroupProvider',
    replica: true,
    contract,
    acquire(key) {
      return source.acquire(key);
    },
    peek(key) {
      return source.peek(key);
    },
    resolveModel(key, name) {
      return lazyReplicaSource(source, key, name);
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
        { mutationId: envelope.mutationId }
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

function lazyReplicaSource<Group extends LiveModelGroupDef>(
  source: ReturnType<typeof createManagedSource<GroupKey<Group>, LiveModelReplicaInstance<Group>>>,
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

async function createReplicaInstance<Group extends LiveModelGroupDef>(
  contract: Group,
  group: ThinGroup<Group>,
  key: GroupKey<Group>,
  addCleanup: (cleanup: () => void | Promise<void>) => void,
  options: LiveModelReplicaOptions,
  runMutation: <Name extends Extract<keyof Group['mutations'], string>>(
    name: Name,
    envelope: {
      key: GroupKey<Group>;
      input: unknown;
      mutationId: string;
    }
  ) => Promise<
    LiveMutationResult<
      MutationData<Group['mutations'][Name]>,
      MutationError<Group['mutations'][Name]>
    >
  >
): Promise<LiveModelReplicaInstance<Group>> {
  const models: Record<string, MaterializedModel<unknown>> = {};
  for (const [name, model] of Object.entries(contract.models)) {
    const materialized = new MaterializedModel(
      group.model(key, name as never) as ThinLiveHandle<unknown>,
      {
        schema: model.dataSchema,
        store: options.store?.(name),
      }
    );
    addCleanup(() => materialized.dispose());
    models[name] = materialized;
  }

  const mutations: Record<string, unknown> = {};
  for (const name of Object.keys(contract.mutations)) {
    mutations[name] = async (
      input: unknown,
      callOptions: MutationCallOptions = {}
    ): Promise<ContractMutationInvocation<unknown, unknown>> => {
      const mutationId = callOptions.mutationId ?? createMutationId();
      const result = await runMutation(name as never, { key, input, mutationId });
      return {
        result,
        settled: result.success
          ? settleCursors(models, contract, mutationId, result.data.cursors)
          : Promise.resolve(),
      };
    };
  }

  const instance: LiveModelReplicaInstance<Group> = {
    key,
    models: models as MaterializedModels<Group>,
    mutations: mutations as MaterializedMutations<Group>,
    ready: Promise.all(Object.values(models).map((model) => model.ready)).then(() => undefined),
  };
  await instance.ready;
  return instance;
}

async function translateCursors(
  instance: LiveModelReplicaInstance,
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

async function settleCursors(
  models: Record<string, MaterializedModel<unknown>>,
  group: LiveModelGroupDef,
  mutationId: string,
  cursors: LiveCursorEntry[]
): Promise<void> {
  await Promise.all(
    cursors.map((entry) => {
      const modelName = modelNameForCursor(group, entry);
      if (!modelName) return Promise.resolve();
      const model = models[modelName];
      if (!model) return Promise.resolve();
      return Promise.any([
        model.waitForMutation(mutationId),
        model.waitForLocalCursor(entry.cursor),
      ]).then(() => undefined);
    })
  );
}

function modelNameForCursor(group: LiveModelGroupDef, entry: LiveCursorEntry): string | undefined {
  for (const [name, model] of Object.entries(group.models)) {
    if (model.id === entry.model) return name;
  }
  return undefined;
}

function modelFor(instance: LiveModelReplicaInstance, name: string): MaterializedModel<unknown> {
  const model = instance.models[name];
  if (!model) throw new Error(`Unknown replica model '${name}'`);
  return model;
}

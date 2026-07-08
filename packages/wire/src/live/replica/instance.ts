import type { MutationCallOptions } from '../../api/client';
import type {
  EndpointLiveModelData,
  GroupKey,
  GroupModels,
  GroupMutations,
  LiveModelEndpointDef,
  LiveModelGroupDef,
  MutationData,
  MutationError,
  MutationInput,
} from '../../api/define';
import type { LiveChangeMeta } from '../model';
import { createMutationId, type LiveMutationResult } from '../mutations';
import type { LiveCursorEntry } from '../protocol';
import type { ReplicaModel, ReplicaModelOptions } from './model';
import type { StateStore } from './store';

export type ContractMutationInvocation<D, E> = {
  result: LiveMutationResult<D, E>;
  settled: Promise<void>;
};

export type ReplicaModels<Group extends LiveModelGroupDef> = {
  [Name in keyof GroupModels<Group>]: ReplicaModel<EndpointLiveModelData<GroupModels<Group>[Name]>>;
};

export type ReplicaMutations<Group extends LiveModelGroupDef> = {
  [Name in keyof GroupMutations<Group>]: (
    input: MutationInput<GroupMutations<Group>[Name]>,
    options?: MutationCallOptions
  ) => Promise<
    ContractMutationInvocation<
      MutationData<GroupMutations<Group>[Name]>,
      MutationError<GroupMutations<Group>[Name]>
    >
  >;
};

export type ReplicaInstance<Group extends LiveModelGroupDef = LiveModelGroupDef> = {
  readonly key: GroupKey<Group>;
  readonly models: ReplicaModels<Group>;
  readonly mutations: ReplicaMutations<Group>;
  readonly ready: Promise<void>;
};

export type ReplicaInstanceOptions = Omit<ReplicaModelOptions<unknown>, 'store' | 'onChange'> & {
  store?: (modelName: string) => StateStore<unknown>;
  onChange?: Record<string, (value: unknown, meta: LiveChangeMeta) => void>;
};

export function buildReplicaInstance<Group extends LiveModelGroupDef>(
  contract: Group,
  key: GroupKey<Group>,
  opts: {
    createModel(name: string, modelDef: LiveModelEndpointDef): ReplicaModel<unknown>;
    mutate<Name extends Extract<keyof GroupMutations<Group>, string>>(
      name: Name,
      envelope: {
        key: GroupKey<Group>;
        input: unknown;
        mutationId: string;
      }
    ): Promise<
      LiveMutationResult<
        MutationData<GroupMutations<Group>[Name]>,
        MutationError<GroupMutations<Group>[Name]>
      >
    >;
  }
): ReplicaInstance<Group> {
  const models: Record<string, ReplicaModel<unknown>> = {};

  for (const [name, model] of Object.entries(contract.models)) {
    models[name] = opts.createModel(name, model);
  }

  const mutations: Record<string, unknown> = {};
  for (const name of Object.keys(contract.mutations)) {
    mutations[name] = async (
      input: unknown,
      callOptions: MutationCallOptions = {}
    ): Promise<ContractMutationInvocation<unknown, unknown>> => {
      const mutationId = callOptions.mutationId ?? createMutationId();
      const result = await opts.mutate(name as never, { key, input, mutationId });
      return {
        result,
        settled: result.success
          ? settleCursors(models, contract, mutationId, result.data.cursors)
          : Promise.resolve(),
      };
    };
  }

  return {
    key,
    models: models as ReplicaModels<Group>,
    mutations: mutations as ReplicaMutations<Group>,
    ready: Promise.all(Object.values(models).map((model) => model.ready)).then(() => undefined),
  };
}

export async function translateCursors(
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

async function settleCursors(
  models: Record<string, ReplicaModel<unknown>>,
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

export function modelNameForCursor(
  group: LiveModelGroupDef,
  entry: LiveCursorEntry
): string | undefined {
  for (const [name, model] of Object.entries(group.models)) {
    if (model.id === entry.model) return name;
  }
  return undefined;
}

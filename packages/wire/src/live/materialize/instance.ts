import type { MutationCallOptions, ThinGroup, ThinLiveHandle } from '../../api/client';
import type {
  EndpointLiveModelData,
  GroupKey,
  GroupModels,
  GroupMutations,
  LiveModelGroupDef,
  MutationData,
  MutationError,
  MutationInput,
} from '../../api/define';
import type { LiveChangeMeta } from '../model';
import { createMutationId, type LiveMutationResult } from '../mutations';
import type { LiveCursorEntry } from '../protocol';
import { MaterializedModel, type MaterializedModelOptions } from './model';
import type { StateStore } from './store';

export type ContractMutationInvocation<D, E> = {
  result: LiveMutationResult<D, E>;
  settled: Promise<void>;
};

export type MaterializedModels<Group extends LiveModelGroupDef> = {
  [Name in keyof GroupModels<Group>]: MaterializedModel<
    EndpointLiveModelData<GroupModels<Group>[Name]>
  >;
};

export type MaterializedMutations<Group extends LiveModelGroupDef> = {
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

export type MaterializedInstance<Group extends LiveModelGroupDef = LiveModelGroupDef> = {
  readonly key: GroupKey<Group>;
  readonly models: MaterializedModels<Group>;
  readonly mutations: MaterializedMutations<Group>;
  readonly ready: Promise<void>;
  dispose(): Promise<void>;
};

export type MaterializeInstanceOptions = Omit<
  MaterializedModelOptions<unknown>,
  'store' | 'onChange'
> & {
  store?: (modelName: string) => StateStore<unknown>;
  onChange?: Record<string, (value: unknown, meta: LiveChangeMeta) => void>;
};

export function materializeInstance<Group extends LiveModelGroupDef>(
  group: ThinGroup<Group>,
  key: GroupKey<Group>,
  options: MaterializeInstanceOptions = {}
): MaterializedInstance<Group> {
  const models: Record<string, MaterializedModel<unknown>> = {};

  for (const [name, model] of Object.entries(group.def.models)) {
    models[name] = new MaterializedModel(
      group.model(key, name as never) as ThinLiveHandle<unknown>,
      {
        instrumentation: options.instrumentation,
        logger: options.logger,
        onChange: options.onChange?.[name],
        schema: model.dataSchema,
        store: options.store?.(name),
      }
    );
  }

  const mutations: Record<string, unknown> = {};
  for (const name of Object.keys(group.def.mutations)) {
    mutations[name] = async (input: unknown, callOptions: MutationCallOptions = {}) => {
      const mutationId = callOptions.mutationId ?? createMutationId();
      const result = (await group.mutate(
        name as never,
        { key, input: input as never, mutationId },
        callOptions
      )) as LiveMutationResult<unknown, unknown>;
      return {
        result,
        settled: result.success
          ? settleCursors(models, group.def, mutationId, result.data.cursors)
          : Promise.resolve(),
      };
    };
  }

  return {
    key,
    models: models as MaterializedModels<Group>,
    mutations: mutations as MaterializedMutations<Group>,
    ready: Promise.all(Object.values(models).map((model) => model.ready)).then(() => undefined),
    async dispose() {
      await Promise.all(Object.values(models).map((model) => model.dispose()));
    },
  };
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
        model.waitForCursor(entry.cursor),
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

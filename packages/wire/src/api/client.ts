import type { z } from 'zod';
import { LiveLogClient, type LiveLogClientDeps } from '../live/log';
import { LiveModelClient, type LiveChangeMeta } from '../live/model';
import { createMutationId, LiveBindingRegistry, type LiveMutationResult } from '../live/mutations';
import type {
  LiveLogSnapshotData,
  LiveSnapshot,
  LiveUpdate,
  LiveCursorEntry,
} from '../live/protocol';
import { encodeTopic } from './bind';
import type { Connection } from './connect';
import type {
  Contract,
  ContractDefinitions,
  EndpointDef,
  EndpointInput,
  EndpointLiveModelData,
  EndpointLiveModelKey,
  EndpointOutput,
  GroupKey,
  GroupModels,
  GroupMutations,
  LiveLogKey,
  LiveModelEndpointDef,
  MutationData,
  MutationError,
  MutationInput,
} from './define';
import { isEndpointDef } from './define';

export type WiredLiveClient<TClient> = {
  client: TClient;
  ready: Promise<void>;
  dispose(): Promise<void>;
};

export type ContractMutationInvocation<D, E> = {
  result: LiveMutationResult<D, E>;
  settled: Promise<void>;
};

export type MutationCallOptions = {
  mutationId?: string;
};

type EndpointClient<Def> = Def extends { kind: 'procedure' }
  ? (input: EndpointInput<Def>) => Promise<EndpointOutput<Def>>
  : Def extends { kind: 'mutation' }
    ? (
        input: MutationInput<Def>,
        options?: MutationCallOptions
      ) => Promise<ContractMutationInvocation<MutationData<Def>, MutationError<Def>>>
    : Def extends LiveModelEndpointDef
      ? (
          key: EndpointLiveModelKey<Def>,
          onChange: (value: EndpointLiveModelData<Def>, meta: LiveChangeMeta) => void
        ) => WiredLiveClient<LiveModelClient<EndpointLiveModelData<Def>>>
      : Def extends { kind: 'liveLog' }
        ? (
            key: LiveLogKey<Def>,
            deps: Omit<LiveLogClientDeps, 'refetchSnapshot'>
          ) => WiredLiveClient<LiveLogClient>
        : Def extends { kind: 'group' }
          ? (key: GroupKey<Def>, onChange?: GroupOnChange<Def>) => GroupBinding<Def>
          : never;

type ContractEntryClient<Def> = Def extends EndpointDef
  ? EndpointClient<Def>
  : Def extends Contract<infer Nested>
    ? ContractClient<Nested>
    : never;

type GroupOnChange<Def> = Def extends { kind: 'group' }
  ? Partial<{
      [Name in keyof GroupModels<Def>]: (
        value: EndpointLiveModelData<GroupModels<Def>[Name]>,
        meta: LiveChangeMeta
      ) => void;
    }>
  : never;

export type GroupBinding<Def> = Def extends { kind: 'group' }
  ? {
      [Name in keyof GroupModels<Def>]: WiredLiveClient<
        LiveModelClient<EndpointLiveModelData<GroupModels<Def>[Name]>>
      >;
    } & {
      [Name in keyof GroupMutations<Def>]: (
        input: MutationInput<GroupMutations<Def>[Name]>,
        options?: MutationCallOptions
      ) => Promise<
        ContractMutationInvocation<
          MutationData<GroupMutations<Def>[Name]>,
          MutationError<GroupMutations<Def>[Name]>
        >
      >;
    } & {
      ready: Promise<void>;
      dispose(): Promise<void>;
    }
  : never;

export type ContractClient<Defs extends ContractDefinitions> = {
  [Name in Extract<keyof Defs, string>]: ContractEntryClient<Defs[Name]>;
};

export function contractClient<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  connection: Connection,
  options: { pathPrefix?: string; bindingRegistry?: LiveBindingRegistry } = {}
): ContractClient<Defs> {
  const bindingRegistry = options.bindingRegistry ?? new LiveBindingRegistry();
  const pathPrefix = options.pathPrefix ? [options.pathPrefix] : [];

  return buildContractClient(
    contract,
    pathPrefix,
    connection,
    bindingRegistry
  ) as ContractClient<Defs>;
}

function buildContractClient(
  contract: ContractDefinitions,
  pathPrefix: string[],
  connection: Connection,
  bindingRegistry: LiveBindingRegistry
): Record<string, unknown> {
  const client: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(contract)) {
    const fullPath = [...pathPrefix, name].join('.');
    if (!isEndpointDef(def)) {
      client[name] = buildContractClient(def, [...pathPrefix, name], connection, bindingRegistry);
      continue;
    }

    switch (def.kind) {
      case 'procedure':
        client[name] = (input: unknown) => connection.call(fullPath, input);
        break;
      case 'mutation':
        client[name] = (input: unknown, options?: MutationCallOptions) =>
          callMutation(connection, bindingRegistry, fullPath, input, options);
        break;
      case 'liveModel':
        client[name] = (key: unknown, onChange: (value: unknown, meta: LiveChangeMeta) => void) =>
          bindModel(connection, bindingRegistry, def, key, onChange);
        break;
      case 'liveLog':
        client[name] = (key: unknown, deps: Omit<LiveLogClientDeps, 'refetchSnapshot'>) =>
          bindLog(connection, def.id, key, deps);
        break;
      case 'group':
        client[name] = (
          key: unknown,
          onChange: Record<string, (value: unknown, meta: LiveChangeMeta) => void> = {}
        ) => bindGroup(connection, bindingRegistry, fullPath, def, key, onChange);
        break;
    }
  }

  return client;
}

function bindModel(
  connection: Connection,
  bindingRegistry: LiveBindingRegistry,
  ref: LiveModelEndpointDef,
  key: unknown,
  onChange: (value: unknown, meta: LiveChangeMeta) => void
): WiredLiveClient<LiveModelClient<unknown>> {
  const topic = encodeTopic(ref.id, key);
  const fetchSnapshot = () => connection.snapshot(topic) as Promise<LiveSnapshot<unknown>>;
  const model = new LiveModelClient(ref.dataSchema as z.ZodType<unknown>, fetchSnapshot, onChange);
  const unregister = bindingRegistry.register(ref, key, model);
  const ready = fetchSnapshot().then((snapshot) => model.seed(snapshot));
  const detach = connection.attach(topic, (update) => model.applyUpdate(update));
  return {
    client: model,
    ready,
    async dispose() {
      unregister();
      (await detach)();
    },
  };
}

function bindLog(
  connection: Connection,
  refId: string,
  key: unknown,
  deps: Omit<LiveLogClientDeps, 'refetchSnapshot'>
): WiredLiveClient<LiveLogClient> {
  const topic = encodeTopic(refId, key);
  const log = new LiveLogClient({
    ...deps,
    refetchSnapshot: () => connection.snapshot(topic) as Promise<LiveSnapshot<LiveLogSnapshotData>>,
  });
  const ready = connection
    .snapshot(topic)
    .then((snapshot) => log.seed(snapshot as LiveSnapshot<LiveLogSnapshotData>));
  const detach = connection.attach(topic, (update: LiveUpdate) => log.applyUpdate(update));
  return {
    client: log,
    ready,
    async dispose() {
      (await detach)();
    },
  };
}

function bindGroup(
  connection: Connection,
  bindingRegistry: LiveBindingRegistry,
  path: string,
  group: {
    models: Record<string, LiveModelEndpointDef>;
    mutations: Record<string, { kind: 'mutation' }>;
  },
  key: unknown,
  onChange: Record<string, (value: unknown, meta: LiveChangeMeta) => void>
): GroupBinding<never> {
  const binding: Record<string, unknown> = {};
  const disposables: Array<() => Promise<void>> = [];
  const ready: Promise<void>[] = [];

  for (const [name, model] of Object.entries(group.models)) {
    const modelBinding = bindModel(
      connection,
      bindingRegistry,
      model,
      key,
      onChange[name] ?? (() => {})
    );
    binding[name] = modelBinding;
    ready.push(modelBinding.ready);
    disposables.push(modelBinding.dispose);
  }

  for (const name of Object.keys(group.mutations)) {
    binding[name] = (input: unknown, options?: MutationCallOptions) =>
      callMutation(connection, bindingRegistry, `${path}.${name}`, { key, input }, options);
  }

  binding.ready = Promise.all(ready).then(() => undefined);
  binding.dispose = async () => {
    await Promise.all(disposables.map((dispose) => dispose()));
  };

  return binding as GroupBinding<never>;
}

async function callMutation<D, E>(
  connection: Connection,
  bindingRegistry: LiveBindingRegistry,
  path: string,
  input: unknown,
  options: MutationCallOptions = {}
): Promise<ContractMutationInvocation<D, E>> {
  const mutationId = options.mutationId ?? createMutationId();
  const result = (await connection.call(
    path,
    addMutationId(input, mutationId)
  )) as LiveMutationResult<D, E>;
  return {
    result,
    settled: result.success
      ? settleCursors(bindingRegistry, mutationId, result.data.cursors)
      : Promise.resolve(),
  };
}

function addMutationId(input: unknown, mutationId: string): unknown {
  if (isGroupEnvelope(input)) return { ...input, mutationId };
  if (typeof input === 'object' && input !== null) return { ...input, mutationId };
  return { value: input, mutationId };
}

function isGroupEnvelope(value: unknown): value is { key: unknown; input: unknown } {
  return typeof value === 'object' && value !== null && 'key' in value && 'input' in value;
}

async function settleCursors(
  bindingRegistry: LiveBindingRegistry,
  mutationId: string,
  cursors: LiveCursorEntry[]
): Promise<void> {
  await Promise.all(
    cursors.map((entry) => {
      const binding = bindingRegistry.find(entry.model, entry.key);
      if (!binding) return Promise.resolve();
      return firstResolved([
        binding.waitForMutation(mutationId),
        binding.waitForCursor(entry.cursor),
      ]);
    })
  );
}

function firstResolved(promises: Promise<void>[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let rejections = 0;
    let lastError: unknown;
    for (const promise of promises) {
      promise.then(resolve, (error: unknown) => {
        rejections += 1;
        lastError = error;
        if (rejections === promises.length) reject(lastError);
      });
    }
  });
}

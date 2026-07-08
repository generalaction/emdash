import type { z } from 'zod';
import { LiveJobClient } from '../live/job';
import { LiveLogClient, type LiveLogClientDeps } from '../live/log';
import { LiveModelClient, type LiveChangeMeta } from '../live/model';
import { createMutationId, LiveBindingRegistry, type LiveMutationResult } from '../live/mutations';
import { liveJobStateSchema } from '../live/protocol';
import type {
  LiveLogSnapshotData,
  LiveJobState,
  LiveSnapshot,
  LiveUpdate,
  LiveCursorEntry,
} from '../live/protocol';
import type { WireInstrumentation } from '../observability';
import { encodeTopic } from './bind';
import type { CallOptions, Connection } from './connect';
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
  JobEndpointDef,
  JobError,
  JobInput,
  JobProgress,
  JobResult,
  LiveLogKey,
  LiveModelEndpointDef,
  MutationData,
  MutationError,
  MutationInput,
} from './define';
import { isEndpointDef } from './define';
import { WireError } from './protocol';

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
  retry?:
    | false
    | {
        maxRetries?: number;
        delayMs?: number;
      };
};

export type ProcedureCallOptions = Pick<CallOptions, 'signal'>;

export type ContractClientOptions = {
  pathPrefix?: string;
  bindingRegistry?: LiveBindingRegistry;
  instrumentation?: WireInstrumentation;
};

type EndpointClient<Def> = Def extends { kind: 'procedure' }
  ? (input: EndpointInput<Def>, options?: ProcedureCallOptions) => Promise<EndpointOutput<Def>>
  : Def extends JobEndpointDef
    ? JobEndpointClient<Def>
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

export type JobHandle<P, R, E> = {
  jobId: string;
  client: LiveJobClient<P, R, E>;
  ready: Promise<void>;
  result: Promise<R>;
  onProgress(cb: (progress: P) => void): () => void;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
};

type JobEndpointClient<Def extends JobEndpointDef> = {
  start(input: JobInput<Def>): Promise<JobHandle<JobProgress<Def>, JobResult<Def>, JobError<Def>>>;
  attach(jobId: string): Promise<JobHandle<JobProgress<Def>, JobResult<Def>, JobError<Def>>>;
};

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
  options: ContractClientOptions = {}
): ContractClient<Defs> {
  const bindingRegistry = options.bindingRegistry ?? new LiveBindingRegistry();
  const pathPrefix = options.pathPrefix ? [options.pathPrefix] : [];

  return buildContractClient(
    contract,
    pathPrefix,
    connection,
    bindingRegistry,
    options.instrumentation
  ) as ContractClient<Defs>;
}

function buildContractClient(
  contract: ContractDefinitions,
  pathPrefix: string[],
  connection: Connection,
  bindingRegistry: LiveBindingRegistry,
  instrumentation: WireInstrumentation | undefined
): Record<string, unknown> {
  const client: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(contract)) {
    const fullPath = [...pathPrefix, name].join('.');
    if (!isEndpointDef(def)) {
      client[name] = buildContractClient(
        def,
        [...pathPrefix, name],
        connection,
        bindingRegistry,
        instrumentation
      );
      continue;
    }

    switch (def.kind) {
      case 'procedure':
        client[name] = (input: unknown, options?: ProcedureCallOptions) =>
          connection.call(fullPath, input, options);
        break;
      case 'job':
        client[name] = createJobEndpointClient(connection, def, fullPath);
        break;
      case 'liveModel':
        client[name] = (key: unknown, onChange: (value: unknown, meta: LiveChangeMeta) => void) =>
          bindModel(connection, bindingRegistry, def, key, onChange, instrumentation);
        break;
      case 'liveLog':
        client[name] = (key: unknown, deps: Omit<LiveLogClientDeps, 'refetchSnapshot'>) =>
          bindLog(connection, def.id, key, deps, instrumentation);
        break;
      case 'group':
        client[name] = (
          key: unknown,
          onChange: Record<string, (value: unknown, meta: LiveChangeMeta) => void> = {}
        ) => bindGroup(connection, bindingRegistry, fullPath, def, key, onChange, instrumentation);
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
  onChange: (value: unknown, meta: LiveChangeMeta) => void,
  instrumentation: WireInstrumentation | undefined
): WiredLiveClient<LiveModelClient<unknown>> {
  const topic = encodeTopic(ref.id, key);
  const fetchSnapshot = () => connection.snapshot(topic) as Promise<LiveSnapshot<unknown>>;
  const model = new LiveModelClient(ref.dataSchema as z.ZodType<unknown>, fetchSnapshot, onChange, {
    instrumentation,
    topic,
  });
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
  deps: Omit<LiveLogClientDeps, 'refetchSnapshot'>,
  instrumentation: WireInstrumentation | undefined
): WiredLiveClient<LiveLogClient> {
  const topic = encodeTopic(refId, key);
  const log = new LiveLogClient({
    ...deps,
    refetchSnapshot: () => connection.snapshot(topic) as Promise<LiveSnapshot<LiveLogSnapshotData>>,
    instrumentation,
    topic,
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

function createJobEndpointClient(
  connection: Connection,
  def: JobEndpointDef,
  path: string
): JobEndpointClient<JobEndpointDef> {
  return {
    async start(input) {
      const started = (await connection.call(`${path}.start`, input)) as { jobId: string };
      return bindJobHandle(connection, def, path, started.jobId);
    },
    attach(jobId) {
      return bindJobHandle(connection, def, path, jobId);
    },
  };
}

async function bindJobHandle(
  connection: Connection,
  def: JobEndpointDef,
  path: string,
  jobId: string
): Promise<JobHandle<unknown, unknown, unknown>> {
  const topic = encodeTopic(def.id, { jobId });
  const stateSchema = liveJobStateSchema(def.progress, def.result, def.error) as z.ZodType<
    LiveJobState<unknown, unknown, unknown>
  >;
  const job = new LiveJobClient<unknown, unknown, unknown>(stateSchema, {
    refetchSnapshot: () =>
      connection.snapshot(topic) as Promise<LiveSnapshot<LiveJobState<unknown, unknown, unknown>>>,
  });
  const ready = connection
    .snapshot(topic)
    .then((snapshot) =>
      job.seed(snapshot as LiveSnapshot<LiveJobState<unknown, unknown, unknown>>)
    );
  const detach = connection.attach(topic, (update: LiveUpdate) => job.applyUpdate(update));
  let disposed = false;

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    (await detach)();
    job.dispose();
  };

  void job.result.then(
    () => dispose(),
    () => dispose()
  );

  return {
    jobId,
    client: job,
    ready,
    result: job.result,
    onProgress: (cb) => job.onProgress(cb),
    async cancel() {
      await connection.call(`${path}.cancel`, { jobId });
    },
    dispose,
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
  onChange: Record<string, (value: unknown, meta: LiveChangeMeta) => void>,
  instrumentation: WireInstrumentation | undefined
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
      onChange[name] ?? (() => {}),
      instrumentation
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
  const result = (await callMutationWithRetry(
    connection,
    path,
    input,
    mutationId,
    options
  )) as LiveMutationResult<D, E>;
  return {
    result,
    settled: result.success
      ? settleCursors(bindingRegistry, mutationId, result.data.cursors)
      : Promise.resolve(),
  };
}

async function callMutationWithRetry(
  connection: Connection,
  path: string,
  input: unknown,
  mutationId: string,
  options: MutationCallOptions
): Promise<unknown> {
  const retry = normalizeRetry(options.retry);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await connection.call(path, addMutationId(input, mutationId));
    } catch (error) {
      if (!shouldRetryMutation(error, attempt, retry.maxRetries)) throw error;
      await delay(retry.delayMs);
    }
  }
}

function normalizeRetry(retry: MutationCallOptions['retry']): {
  maxRetries: number;
  delayMs: number;
} {
  if (retry === false) return { maxRetries: 0, delayMs: 0 };
  return {
    maxRetries: retry?.maxRetries ?? 2,
    delayMs: retry?.delayMs ?? 0,
  };
}

function shouldRetryMutation(error: unknown, attempt: number, maxRetries: number): boolean {
  return error instanceof WireError && error.code === 'DISCONNECTED' && attempt < maxRetries;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addMutationId(input: unknown, mutationId: string): unknown {
  return { ...(input as { key: unknown; input: unknown }), mutationId };
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
      return Promise.any([
        binding.waitForMutation(mutationId),
        binding.waitForCursor(entry.cursor),
      ]);
    })
  );
}

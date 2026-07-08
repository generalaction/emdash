import type { Unsubscribe } from '@emdash/shared';
import { createMutationId, type LiveMutationResult } from '../live/mutations';
import type { LiveLogSnapshotData, LiveSnapshot, LiveSource, LiveUpdate } from '../live/protocol';
import type { CallOptions, Connection } from './connect';
import type {
  Contract,
  ContractDefinitions,
  EndpointDef,
  EndpointInput,
  EndpointLiveModelData,
  EndpointOutput,
  GroupKey,
  GroupModels,
  GroupMutations,
  JobEndpointDef,
  JobError,
  JobInput,
  JobProgress,
  JobResult,
  LiveLogEndpointDef,
  LiveLogKey,
  LiveModelGroupDef,
  MutationData,
  MutationError,
  MutationInput,
} from './define';
import { isEndpointDef } from './define';
import { WireError } from './protocol';
import { encodeTopic } from './topics';

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

export type ClientOptions = {
  pathPrefix?: string;
};

export type ThinAttachOptions = {
  onReattach?: () => void;
};

export type ThinLiveHandle<T = unknown> = {
  readonly topic: string;
  snapshot(): Promise<LiveSnapshot<T>>;
  attach(push: (update: LiveUpdate) => void, options?: ThinAttachOptions): Promise<Unsubscribe>;
  asLiveSource(): LiveSource;
};

export type ThinLiveLogRef<Def extends LiveLogEndpointDef = LiveLogEndpointDef> = {
  readonly kind: 'thinLiveLog';
  readonly def: Def;
  handle(key: LiveLogKey<Def>): ThinLiveHandle<LiveLogSnapshotData>;
};

export type ThinGroup<Def extends LiveModelGroupDef = LiveModelGroupDef> =
  Def extends LiveModelGroupDef
    ? {
        readonly kind: 'thinGroup';
        readonly def: Def;
        model<Name extends Extract<keyof GroupModels<Def>, string>>(
          key: GroupKey<Def>,
          name: Name
        ): ThinLiveHandle<EndpointLiveModelData<GroupModels<Def>[Name]>>;
        mutate<Name extends Extract<keyof GroupMutations<Def>, string>>(
          name: Name,
          envelope: {
            key: GroupKey<Def>;
            input: MutationInput<GroupMutations<Def>[Name]>;
            mutationId?: string;
          },
          options?: MutationCallOptions
        ): Promise<
          LiveMutationResult<
            MutationData<GroupMutations<Def>[Name]>,
            MutationError<GroupMutations<Def>[Name]>
          >
        >;
      }
    : never;

export type ThinJob<Def extends JobEndpointDef = JobEndpointDef> = {
  readonly kind: 'thinJob';
  readonly def: Def;
  start(input: JobInput<Def>): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<void>;
  handle(jobId: string): ThinLiveHandle<LiveJobStateFor<Def>>;
};

export type LiveJobStateFor<Def extends JobEndpointDef> =
  | {
      status: 'running';
      startedAt: number;
      progress: JobProgress<Def>[];
      progressCount: number;
    }
  | {
      status: 'succeeded';
      startedAt: number;
      finishedAt: number;
      progress: JobProgress<Def>[];
      result: JobResult<Def>;
    }
  | {
      status: 'failed';
      startedAt: number;
      finishedAt: number;
      progress: JobProgress<Def>[];
      error: JobError<Def>;
    }
  | {
      status: 'cancelled';
      startedAt: number;
      finishedAt: number;
      progress: JobProgress<Def>[];
    };

type EndpointClient<Def> = Def extends { kind: 'procedure' }
  ? (input: EndpointInput<Def>, options?: ProcedureCallOptions) => Promise<EndpointOutput<Def>>
  : Def extends JobEndpointDef
    ? ThinJob<Def>
    : Def extends LiveLogEndpointDef
      ? ThinLiveLogRef<Def>
      : Def extends LiveModelGroupDef
        ? ThinGroup<Def>
        : never;

type ContractEntryClient<Def> = Def extends EndpointDef
  ? EndpointClient<Def>
  : Def extends Contract<infer Nested>
    ? ThinClient<Nested>
    : never;

export type ThinClient<Defs extends ContractDefinitions> = {
  [Name in Extract<keyof Defs, string>]: ContractEntryClient<Defs[Name]>;
};

export function client<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  connection: Connection,
  options: ClientOptions = {}
): ThinClient<Defs> {
  const pathPrefix = options.pathPrefix ? [options.pathPrefix] : [];
  return buildContractClient(contract, pathPrefix, connection) as ThinClient<Defs>;
}

function buildContractClient(
  contract: ContractDefinitions,
  pathPrefix: string[],
  connection: Connection
): Record<string, unknown> {
  const client: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(contract)) {
    const fullPath = [...pathPrefix, name].join('.');
    if (!isEndpointDef(def)) {
      client[name] = buildContractClient(def, [...pathPrefix, name], connection);
      continue;
    }

    switch (def.kind) {
      case 'procedure':
        client[name] = (input: unknown, options?: ProcedureCallOptions) =>
          connection.call(fullPath, input, options);
        break;
      case 'job':
        client[name] = createThinJob(connection, def, fullPath);
        break;
      case 'liveLog':
        client[name] = createThinLiveLog(connection, def);
        break;
      case 'group':
        client[name] = createThinGroup(connection, fullPath, def);
        break;
    }
  }

  return client;
}

function createThinLiveLog<Def extends LiveLogEndpointDef>(
  connection: Connection,
  def: Def
): ThinLiveLogRef<Def> {
  return {
    kind: 'thinLiveLog',
    def,
    handle: (key) => createThinLiveHandle(connection, encodeTopic(def.id, key)),
  };
}

function createThinJob<Def extends JobEndpointDef>(
  connection: Connection,
  def: Def,
  path: string
): ThinJob<Def> {
  return {
    kind: 'thinJob',
    def,
    async start(input) {
      return (await connection.call(`${path}.start`, input)) as { jobId: string };
    },
    async cancel(jobId) {
      await connection.call(`${path}.cancel`, { jobId });
    },
    handle(jobId) {
      return createThinLiveHandle(connection, encodeTopic(def.id, { jobId }));
    },
  };
}

function createThinGroup<Def extends LiveModelGroupDef>(
  connection: Connection,
  path: string,
  def: Def
): ThinGroup<Def> {
  return {
    kind: 'thinGroup',
    def,
    model(key: unknown, name: string) {
      const model = def.models[name];
      return createThinLiveHandle(connection, encodeTopic(model.id, key));
    },
    mutate(
      name: string,
      envelope: { key: unknown; input: unknown; mutationId?: string },
      options?: MutationCallOptions
    ) {
      const mutationId = envelope.mutationId ?? options?.mutationId ?? createMutationId();
      return callMutationWithRetry(
        connection,
        `${path}.${name}`,
        envelope,
        mutationId,
        options ?? {}
      ) as Promise<LiveMutationResult<never, never>>;
    },
  } as unknown as ThinGroup<Def>;
}

function createThinLiveHandle<T>(connection: Connection, topic: string): ThinLiveHandle<T> {
  return {
    topic,
    snapshot: () => connection.snapshot(topic) as Promise<LiveSnapshot<T>>,
    attach: (push, options) => connection.attach(topic, push, options),
    asLiveSource() {
      return {
        snapshot: () => connection.snapshot(topic),
        subscribe: (cb): Unsubscribe => {
          let disposed = false;
          const attach = connection.attach(topic, cb).catch(() => () => {});
          void attach.then((detach) => {
            if (disposed) detach();
          });
          return () => {
            disposed = true;
            void attach.then((detach) => detach());
          };
        },
      };
    },
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

export function isThinLiveLogRef(value: unknown): value is ThinLiveLogRef {
  return isTagged(value, 'thinLiveLog');
}

export function isThinGroup(value: unknown): value is ThinGroup {
  return isTagged(value, 'thinGroup');
}

export function isThinJob(value: unknown): value is ThinJob {
  return isTagged(value, 'thinJob');
}

function isTagged(value: unknown, kind: string): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === kind;
}

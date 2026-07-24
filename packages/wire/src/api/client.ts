import { ok, type Result, type SerializedError, type Unsubscribe } from '@emdash/shared';
import { retry as retryOperation, retrySchedules } from '@emdash/shared/scheduling';
import { eventFromUpdate } from '../live/event-stream';
import { createMutationId, type LiveMutationResult } from '../live/mutations';
import type {
  EventStreamSnapshotData,
  LiveLogSnapshotData,
  LiveSnapshot,
  LiveSource,
  LiveUpdate,
} from '../live/protocol';
import {
  createSingleUseDownloadHandle,
  normalizeUploadFile,
  type BlobDownloadHandle,
  type UploadFileValue,
} from './blob-channel';
import type { AttachOptions, CallOptions, Connection } from './connect';
import type {
  Contract,
  ContractDefinitions,
  DownloadFileEndpointDef,
  DownloadFileError,
  DownloadFileInput,
  DownloadFileMeta,
  EndpointDef,
  EventStreamEndpointDef,
  EventStreamEvent,
  EventStreamKey,
  EndpointInput,
  LiveStateData,
  EndpointOutput,
  LiveModelKey,
  LiveModelStates,
  LiveModelMutations,
  LiveJobEndpointDef,
  JobError,
  JobInput,
  JobProgress,
  JobResult,
  LiveLogEndpointDef,
  LiveLogKey,
  LiveModelDef,
  MutationData,
  MutationError,
  MutationInput,
  UploadFileEndpointDef,
  UploadFileError,
  UploadFileInput,
  UploadFileResult,
} from './define';
import { isEndpointDef } from './define';
import { WireError } from './protocol';
import { encodeTopic } from './topics';

export type MutationCallOptions = {
  signal?: AbortSignal;
  mutationId?: string;
  retry?:
    | false
    | {
        maxRetries?: number;
        delayMs?: number;
      };
};

export type ProcedureCallOptions = Pick<CallOptions, 'signal'>;
export type FileUploadCallOptions = ProcedureCallOptions & {
  onProgress?: (progress: { sent: number; total?: number }) => void;
};

export type ClientOptions = {
  pathPrefix?: string;
};

export type LiveClientHandle<T = unknown> = {
  readonly topic: string;
  snapshot(): Promise<LiveSnapshot<T>>;
  attach(push: (update: LiveUpdate) => void, options?: AttachOptions): Promise<Unsubscribe>;
  asLiveSource(): LiveSource;
};

export type LiveLogClientHandle<Def extends LiveLogEndpointDef = LiveLogEndpointDef> = {
  readonly kind: 'liveLogClientHandle';
  readonly def: Def;
  handle(key: LiveLogKey<Def>): LiveClientHandle<LiveLogSnapshotData>;
};

export type EventStreamSubscribeOptions<
  Def extends EventStreamEndpointDef = EventStreamEndpointDef,
> = {
  onEvent(event: EventStreamEvent<Def>): void;
  onGap?(): void;
  onError?: (error: WireError, context: { retrying: boolean }) => void;
};

export type EventStreamClientHandle<Def extends EventStreamEndpointDef = EventStreamEndpointDef> = {
  readonly kind: 'eventStreamClientHandle';
  readonly def: Def;
  handle(key: EventStreamKey<Def>): LiveClientHandle<EventStreamSnapshotData>;
  subscribe(
    key: EventStreamKey<Def>,
    options: EventStreamSubscribeOptions<Def>
  ): Promise<Unsubscribe>;
};

export type LiveModelClientHandle<Def extends LiveModelDef = LiveModelDef> =
  Def extends LiveModelDef
    ? {
        readonly kind: 'liveModelClientHandle';
        readonly def: Def;
        state<Name extends Extract<keyof LiveModelStates<Def>, string>>(
          key: LiveModelKey<Def>,
          name: Name
        ): LiveClientHandle<LiveStateData<LiveModelStates<Def>[Name]>>;
        mutate<Name extends Extract<keyof LiveModelMutations<Def>, string>>(
          name: Name,
          envelope: {
            key: LiveModelKey<Def>;
            input: MutationInput<LiveModelMutations<Def>[Name]>;
            mutationId?: string;
          },
          options?: MutationCallOptions
        ): Promise<
          LiveMutationResult<
            MutationData<LiveModelMutations<Def>[Name]>,
            MutationError<LiveModelMutations<Def>[Name]>
          >
        >;
      }
    : never;

export type LiveJobClientHandle<Def extends LiveJobEndpointDef = LiveJobEndpointDef> = {
  readonly kind: 'liveJobClientHandle';
  readonly def: Def;
  start(input: JobInput<Def>): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<void>;
  handle(jobId: string): LiveClientHandle<LiveJobStateFor<Def>>;
};

export type LiveJobStateFor<Def extends LiveJobEndpointDef> =
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
      error?: JobError<Def>;
      cause?: SerializedError;
    }
  | {
      status: 'cancelled';
      startedAt: number;
      finishedAt: number;
      progress: JobProgress<Def>[];
    };

type EndpointClient<Def> = Def extends { kind: 'procedure' }
  ? (input: EndpointInput<Def>, options?: ProcedureCallOptions) => Promise<EndpointOutput<Def>>
  : Def extends LiveJobEndpointDef
    ? LiveJobClientHandle<Def>
    : Def extends EventStreamEndpointDef
      ? EventStreamClientHandle<Def>
      : Def extends LiveLogEndpointDef
        ? LiveLogClientHandle<Def>
        : Def extends LiveModelDef
          ? LiveModelClientHandle<Def>
          : Def extends DownloadFileEndpointDef
            ? (
                input: DownloadFileInput<Def>,
                options?: ProcedureCallOptions
              ) => Promise<
                Result<BlobDownloadHandle<DownloadFileMeta<Def>>, DownloadFileError<Def>>
              >
            : Def extends UploadFileEndpointDef
              ? (
                  input: UploadFileInput<Def>,
                  file: UploadFileValue,
                  options?: FileUploadCallOptions
                ) => Promise<Result<UploadFileResult<Def>, UploadFileError<Def>>>
              : never;

type ContractEntryClient<Def> = Def extends EndpointDef
  ? EndpointClient<Def>
  : Def extends Contract<infer Nested>
    ? ContractClient<Nested>
    : never;

export type ContractClient<Defs extends ContractDefinitions> = {
  [Name in Extract<keyof Defs, string>]: ContractEntryClient<Defs[Name]>;
};

export function client<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  connection: Connection,
  options: ClientOptions = {}
): ContractClient<Defs> {
  const pathPrefix = options.pathPrefix ? [options.pathPrefix] : [];
  return buildContractClient(contract, pathPrefix, connection) as ContractClient<Defs>;
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
      case 'downloadFile':
        client[name] = async (input: unknown, options?: ProcedureCallOptions) => {
          const result = (await connection.call(fullPath, input, options)) as Result<
            { meta: DownloadFileMeta<typeof def>; channel: string },
            unknown
          >;
          if (!result.success) return result;
          const handle = createSingleUseDownloadHandle(
            result.data.meta,
            connection.openBlobConsumer(result.data.channel)
          );
          options?.signal?.addEventListener('abort', () => handle.cancel(), { once: true });
          return ok(handle);
        };
        break;
      case 'uploadFile':
        client[name] = async (
          input: unknown,
          file: UploadFileValue,
          options?: FileUploadCallOptions
        ) => {
          const { meta, source } = normalizeUploadFile(file);
          const channel = createRequestId();
          const producer = connection.openBlobProducer(channel, source);
          const onAbort = (): void => producer.close();
          options?.signal?.addEventListener('abort', onAbort, { once: true });
          try {
            return (await connection.call(fullPath, input, {
              signal: options?.signal,
              upload: { channel, meta },
            })) as Result<unknown, unknown>;
          } finally {
            options?.signal?.removeEventListener('abort', onAbort);
            producer.close();
          }
        };
        break;
      case 'liveJob':
        client[name] = createLiveJobClientHandle(connection, def, fullPath);
        break;
      case 'liveLog':
        client[name] = createLiveLogClientHandle(connection, def);
        break;
      case 'eventStream':
        client[name] = createEventStreamClientHandle(connection, def);
        break;
      case 'liveModel':
        client[name] = createLiveModelClientHandle(connection, fullPath, def);
        break;
    }
  }

  return client;
}

function createLiveLogClientHandle<Def extends LiveLogEndpointDef>(
  connection: Connection,
  def: Def
): LiveLogClientHandle<Def> {
  return {
    kind: 'liveLogClientHandle',
    def,
    handle: (key) => createLiveClientHandle(connection, encodeTopic(def.id, key)),
  };
}

function createEventStreamClientHandle<Def extends EventStreamEndpointDef>(
  connection: Connection,
  def: Def
): EventStreamClientHandle<Def> {
  return {
    kind: 'eventStreamClientHandle',
    def,
    handle: (key) => createLiveClientHandle(connection, encodeTopic(def.id, key)),
    subscribe(key, options) {
      return connection.attach(
        encodeTopic(def.id, key),
        (update) => options.onEvent(eventFromUpdate<EventStreamEvent<Def>>(update)),
        {
          onReattach: options.onGap,
          onReattachError: options.onError,
        }
      );
    },
  };
}

function createLiveJobClientHandle<Def extends LiveJobEndpointDef>(
  connection: Connection,
  def: Def,
  path: string
): LiveJobClientHandle<Def> {
  return {
    kind: 'liveJobClientHandle',
    def,
    async start(input) {
      return (await connection.call(`${path}.start`, input)) as { jobId: string };
    },
    async cancel(jobId) {
      await connection.call(`${path}.cancel`, { jobId });
    },
    handle(jobId) {
      return createLiveClientHandle(connection, encodeTopic(def.id, { jobId }));
    },
  };
}

function createLiveModelClientHandle<Def extends LiveModelDef>(
  connection: Connection,
  path: string,
  def: Def
): LiveModelClientHandle<Def> {
  return {
    kind: 'liveModelClientHandle',
    def,
    state(key: unknown, name: string) {
      const state = def.states[name];
      return createLiveClientHandle(connection, encodeTopic(state.id, key));
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
  } as unknown as LiveModelClientHandle<Def>;
}

function createLiveClientHandle<T>(connection: Connection, topic: string): LiveClientHandle<T> {
  return {
    topic,
    snapshot: () => connection.snapshot(topic) as Promise<LiveSnapshot<T>>,
    attach: (push, options) => connection.attach(topic, push, options),
    asLiveSource() {
      return {
        snapshot: () => connection.snapshot(topic),
        subscribe: (cb, options) =>
          connection.attach(topic, cb, {
            onReattach: options?.onGap,
            onReattachError: options?.onError,
          }),
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
  const retryOptions = normalizeRetry(options.retry);
  return await retryOperation(
    () => connection.call(path, addMutationId(input, mutationId), { signal: options.signal }),
    {
      signal: options.signal,
      schedule: retrySchedules.fixed(retryOptions.delayMs, retryOptions.maxRetries),
      shouldRetry: shouldRetryMutation,
    }
  );
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

function shouldRetryMutation(error: unknown): boolean {
  return error instanceof WireError && error.code === 'DISCONNECTED';
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `wire_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function addMutationId(input: unknown, mutationId: string): unknown {
  return { ...(input as { key: unknown; input: unknown }), mutationId };
}

export function isLiveLogClientHandle(value: unknown): value is LiveLogClientHandle {
  return isTagged(value, 'liveLogClientHandle');
}

export function isEventStreamClientHandle(value: unknown): value is EventStreamClientHandle {
  return isTagged(value, 'eventStreamClientHandle');
}

export function isLiveModelClientHandle(value: unknown): value is LiveModelClientHandle {
  return isTagged(value, 'liveModelClientHandle');
}

export function isLiveJobClientHandle(value: unknown): value is LiveJobClientHandle {
  return isTagged(value, 'liveJobClientHandle');
}

function isTagged(value: unknown, kind: string): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === kind;
}

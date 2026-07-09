import { resultSchema, type Result, type Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import { LiveJob, type LiveJobContext } from '../live/job';
import {
  isLiveModelHost,
  type LiveModelHost,
  createMutationId,
  type LiveMutationResult,
} from '../live/mutations';
import type { LiveSource } from '../live/protocol';
import { liveCursorEntrySchema } from '../live/protocol';
import {
  isLiveJobReplica,
  isLiveLogReplica,
  isLiveModelProvider,
  type LiveJobReplica,
  type LiveLogReplica,
  type LiveModelProvider,
} from '../live/replica';
import type { BlobSource, WireFile } from './blob-channel';
import {
  isLiveModelClientHandle,
  isLiveJobClientHandle,
  isLiveLogClientHandle,
  type LiveModelClientHandle,
  type LiveJobClientHandle,
  type LiveLogClientHandle,
} from './client';
import type {
  Contract,
  ContractDefinitions,
  DownloadFileEndpointDef,
  DownloadFileError,
  DownloadFileInput,
  DownloadFileMeta,
  EndpointDef,
  EndpointInput,
  EndpointOutput,
  LiveLogKey,
  LiveJobEndpointDef,
  JobInput,
  JobProgress,
  JobResult,
  JobError,
  LiveModelDef,
  MutationDef,
  UploadFileEndpointDef,
  UploadFileError,
  UploadFileInput,
  UploadFileResult,
} from './define';
import { isEndpointDef } from './define';
import type { WireFileMeta } from './protocol';
import { WireError } from './protocol';
import { splitTopic } from './topics';

export type CallMeta = {
  signal?: AbortSignal;
  uploadFile?: WireFile;
};

const downloadFileOpenSymbol: unique symbol = Symbol('wire.downloadFileOpen');

export type DownloadFileOpen = {
  readonly [downloadFileOpenSymbol]: true;
  readonly meta: WireFileMeta;
  readonly source: BlobSource;
};

export function markDownloadFileOpen(meta: WireFileMeta, source: BlobSource): DownloadFileOpen {
  return { [downloadFileOpenSymbol]: true, meta, source };
}

export function isDownloadFileOpenResult(
  value: unknown
): value is { success: true; data: DownloadFileOpen } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    typeof (value as { data?: unknown }).data === 'object' &&
    (value as { data?: { [downloadFileOpenSymbol]?: unknown } }).data?.[downloadFileOpenSymbol] ===
      true
  );
}

export type Controller = {
  call(path: string, input: unknown, meta?: CallMeta): Promise<unknown>;
  resolveLive(topic: string): LiveSource | null;
  dispose?(): void;
};

export type ValidatePolicy = 'none' | 'inputs' | 'full';

type ProcedureImpl<Def extends EndpointDef> = (
  input: EndpointInput<Def>,
  meta: CallMeta
) => Promise<EndpointOutput<Def>> | EndpointOutput<Def>;

type DownloadFileImpl<Def extends DownloadFileEndpointDef> = (
  input: DownloadFileInput<Def>,
  meta: CallMeta
) =>
  | Promise<Result<{ meta: DownloadFileMeta<Def>; source: BlobSource }, DownloadFileError<Def>>>
  | Result<{ meta: DownloadFileMeta<Def>; source: BlobSource }, DownloadFileError<Def>>;

type UploadFileImpl<Def extends UploadFileEndpointDef> = (
  input: UploadFileInput<Def>,
  file: WireFile,
  meta: CallMeta
) =>
  | Promise<Result<UploadFileResult<Def>, UploadFileError<Def>>>
  | Result<UploadFileResult<Def>, UploadFileError<Def>>;

type LiveLogImpl<Def extends EndpointDef> = (key: LiveLogKey<Def>) => LiveSource | null | undefined;

type LiveLogEntryImpl<Def extends EndpointDef> =
  | LiveLogImpl<Def>
  | LiveLogClientHandle
  | LiveLogReplica;

type GroupImpl<Def extends LiveModelDef> =
  | LiveModelHost<Def>
  | LiveModelClientHandle<Def>
  | LiveModelProvider<Def>;

type EndpointImpl<Def extends EndpointDef> = Def extends { kind: 'procedure' }
  ? ProcedureImpl<Def>
  : Def extends { kind: 'liveLog' }
    ? LiveLogEntryImpl<Def>
    : Def extends LiveModelDef
      ? GroupImpl<Def>
      : Def extends LiveJobEndpointDef
        ? JobImpl<Def> | LiveJobClientHandle<Def> | LiveJobReplica<Def>
        : Def extends DownloadFileEndpointDef
          ? DownloadFileImpl<Def>
          : Def extends UploadFileEndpointDef
            ? UploadFileImpl<Def>
            : never;

type JobImpl<Def extends LiveJobEndpointDef> = {
  run(
    input: JobInput<Def>,
    ctx: LiveJobContext<JobProgress<Def>>
  ): Promise<Result<JobResult<Def>, JobError<Def>>> | Result<JobResult<Def>, JobError<Def>>;
  toError?(error: unknown): JobError<Def>;
};

export type ContractImpl<Defs extends ContractDefinitions> = {
  [Name in keyof Defs]?: Defs[Name] extends EndpointDef
    ? EndpointImpl<Defs[Name]>
    : Defs[Name] extends Contract<infer Nested>
      ? ContractImpl<Nested>
      : never;
};

export type CreateControllerOptions = {
  validate?: ValidatePolicy;
};

type LiveEntry = {
  keySchema: z.ZodTypeAny;
  resolve(key: unknown): LiveSource | null | undefined;
};

const jobKeySchema = z.object({ jobId: z.string() });

export function createController<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  impl: ContractImpl<Defs>,
  options: CreateControllerOptions = {}
): Controller {
  const validate = options.validate ?? 'none';
  const liveEntries = new Map<string, LiveEntry>();
  const procedureEntries = new Map<string, (input: unknown, meta: CallMeta) => Promise<unknown>>();
  const jobServers: Array<{ dispose(): void }> = [];

  collectContractEntries(contract, impl as Record<string, unknown>, []);

  function collectContractEntries(
    definitions: ContractDefinitions,
    impl: Record<string, unknown> | undefined,
    prefix: string[]
  ): void {
    for (const [name, def] of Object.entries(definitions)) {
      const fullPath = [...prefix, name].join('.');
      const entryImpl = impl?.[name];
      if (!isEndpointDef(def)) {
        collectContractEntries(
          def,
          isRecord(entryImpl) ? (entryImpl as Record<string, unknown>) : undefined,
          [...prefix, name]
        );
        continue;
      }

      switch (def.kind) {
        case 'procedure': {
          const handler = entryImpl as ((input: unknown, meta: CallMeta) => unknown) | undefined;
          if (!handler) break;
          procedureEntries.set(fullPath, async (input, meta) => {
            const parsedInput = validate === 'none' ? input : def.input.parse(input);
            const output = await handler(parsedInput, meta);
            return validate === 'full' ? def.output.parse(output) : output;
          });
          break;
        }
        case 'downloadFile': {
          const handler = entryImpl as DownloadFileImpl<DownloadFileEndpointDef> | undefined;
          if (!handler) break;
          procedureEntries.set(fullPath, async (input, meta) => {
            const parsedInput = validate === 'none' ? input : def.input.parse(input);
            const output = await handler(parsedInput, meta);
            if (!output.success) {
              return validate === 'full'
                ? { success: false, error: def.error.parse(output.error) }
                : output;
            }
            const parsedMeta =
              validate === 'none' ? output.data.meta : def.meta.parse(output.data.meta);
            return {
              success: true,
              data: markDownloadFileOpen(parsedMeta as WireFileMeta, output.data.source),
            };
          });
          break;
        }
        case 'uploadFile': {
          const handler = entryImpl as UploadFileImpl<UploadFileEndpointDef> | undefined;
          if (!handler) break;
          procedureEntries.set(fullPath, async (input, meta) => {
            const uploadFile = meta.uploadFile;
            if (!uploadFile) {
              throw new WireError(
                'HANDLER_ERROR',
                `Upload file '${fullPath}' requires a file payload`
              );
            }
            const parsedInput = validate === 'none' ? input : def.input.parse(input);
            validateUploadFileEnvelope(def, uploadFile);
            const output = await handler(
              parsedInput,
              limitUploadFile(uploadFile, def.maxSize),
              meta
            );
            if (validate !== 'full') return output;
            return resultSchema(def.result, def.error).parse(output) as Result<unknown, unknown>;
          });
          break;
        }
        case 'liveLog': {
          const impl = entryImpl as LiveLogEntryImpl<EndpointDef> | undefined;
          if (!impl) {
            throw new WireError('MISSING_HANDLER', `Live log '${fullPath}' requires a resolver`);
          }
          if (isLiveLogReplica(impl) && impl.def.id !== def.id) {
            throw new WireError(
              'CONTRACT_MISMATCH',
              `Live log replica for '${fullPath}' was created for '${impl.def.id}'`
            );
          }
          liveEntries.set(def.id, {
            keySchema: def.keySchema,
            resolve: createLiveLogResolver(impl),
          });
          break;
        }
        case 'liveJob': {
          const impl = entryImpl as
            | JobImpl<LiveJobEndpointDef>
            | LiveJobClientHandle
            | LiveJobReplica
            | undefined;
          if (!impl) {
            throw new WireError('MISSING_HANDLER', `Job '${fullPath}' requires a handler`);
          }
          if (isLiveJobClientHandle(impl)) {
            procedureEntries.set(`${fullPath}.start`, (input) => impl.start(input as never));
            procedureEntries.set(`${fullPath}.cancel`, async (input) => {
              const parsed = z.object({ jobId: z.string() }).parse(input);
              await impl.cancel(parsed.jobId);
              return undefined;
            });
            liveEntries.set(def.id, {
              keySchema: jobKeySchema,
              resolve: (key) => impl.handle((key as { jobId: string }).jobId).asLiveSource(),
            });
            break;
          }
          if (isLiveJobReplica(impl)) {
            if (impl.def.id !== def.id) {
              throw new WireError(
                'CONTRACT_MISMATCH',
                `Live job replica for '${fullPath}' was created for '${impl.def.id}'`
              );
            }
            procedureEntries.set(`${fullPath}.start`, async (input) => {
              const lease = await impl.start(input as never);
              try {
                const job = await lease.ready();
                return { jobId: job.jobId };
              } finally {
                await lease.release();
              }
            });
            procedureEntries.set(`${fullPath}.cancel`, async (input) => {
              const parsed = z.object({ jobId: z.string() }).parse(input);
              await impl.cancel(parsed.jobId);
              return undefined;
            });
            liveEntries.set(def.id, {
              keySchema: jobKeySchema,
              resolve: (key) => impl.resolve((key as { jobId: string }).jobId),
            });
            break;
          }
          const server = createLiveJob(def, impl, validate);
          jobServers.push(server);
          procedureEntries.set(`${fullPath}.start`, async (input) => {
            const parsedInput = validate === 'none' ? input : def.input.parse(input);
            return server.start(parsedInput);
          });
          procedureEntries.set(`${fullPath}.cancel`, async (input) => {
            const parsed = z.object({ jobId: z.string() }).parse(input);
            server.cancel(parsed.jobId);
            return undefined;
          });
          liveEntries.set(def.id, {
            keySchema: jobKeySchema,
            resolve: (key) => server.source((key as { jobId: string }).jobId),
          });
          break;
        }
        case 'liveModel': {
          const provider = createGroupProvider(def, entryImpl, fullPath);
          for (const [stateName, state] of Object.entries(def.states)) {
            liveEntries.set(state.id, {
              keySchema: def.keySchema,
              resolve: (key) => provider.resolveState(key as never, stateName),
            });
          }
          for (const [mutationName, mutationDef] of Object.entries(def.mutations)) {
            procedureEntries.set(`${fullPath}.${mutationName}`, async (input) => {
              const envelope = parseGroupMutationInput(def, mutationDef, input, validate);
              const output = await provider.runMutation(mutationName, envelope as never);
              return validateMutationOutput(mutationDef, output, validate);
            });
          }
          break;
        }
      }
    }
  }

  function createGroupProvider(
    def: LiveModelDef,
    entryImpl: unknown,
    fullPath: string
  ): LiveModelProvider {
    if (isLiveModelProvider(entryImpl)) {
      if (entryImpl.contract.id !== def.id) {
        throw new WireError(
          'CONTRACT_MISMATCH',
          `Live model provider for '${fullPath}' was created for '${entryImpl.contract.id}'`
        );
      }
      return entryImpl;
    }

    if (isLiveModelClientHandle(entryImpl)) {
      if (entryImpl.def.id !== def.id) {
        throw new WireError(
          'CONTRACT_MISMATCH',
          `Live model client handle for '${fullPath}' was created for '${entryImpl.def.id}'`
        );
      }
      return {
        kind: 'liveModelProvider',
        contract: def,
        resolveState: (key, name) => entryImpl.state(key, name).asLiveSource(),
        runMutation: (name, envelope) => entryImpl.mutate(name, envelope),
      };
    }

    if (isLiveModelHost(entryImpl)) {
      const host = entryImpl as LiveModelHost<LiveModelDef>;
      if (host.contract.id !== def.id) {
        throw new WireError(
          'CONTRACT_MISMATCH',
          `Live model host for '${fullPath}' was created for '${host.contract.id}'`
        );
      }
      for (const [mutationName, mutationDef] of Object.entries(def.mutations)) {
        if (mutationDef.handler ?? host.mutationHandler(mutationName)) continue;
        throw new WireError(
          'MISSING_HANDLER',
          `Mutation '${fullPath}.${mutationName}' requires a handler`
        );
      }
      return {
        kind: 'liveModelProvider',
        contract: def,
        resolveState: (key, name) => host.get(key as never)?.states[name],
        runMutation: (name, envelope) => host.runMutation(name as never, envelope as never),
      };
    }

    throw new WireError(
      'MISSING_HANDLER',
      `Group '${fullPath}' requires a LiveModelHost or provider`
    );
  }

  return {
    async call(path, input, meta = {}) {
      const handler = procedureEntries.get(path);
      if (!handler) throw new WireError('UNKNOWN_PROCEDURE', `Unknown procedure '${path}'`);
      return await handler(input, meta);
    },
    resolveLive(topic) {
      const { refId, rawKey } = splitTopic(topic);
      const entry = liveEntries.get(refId);
      if (!entry) return null;
      const key = validate === 'none' ? rawKey : entry.keySchema.parse(rawKey);
      return entry.resolve(key) ?? missingLiveSource(`Unknown live topic '${topic}'`);
    },
    dispose() {
      for (const server of jobServers) server.dispose();
    },
  };
}

function limitUploadFile(file: WireFile, maxSize: number | undefined): WireFile {
  if (maxSize === undefined) return file;
  return {
    ...file,
    stream() {
      return (async function* () {
        const iterator = file.stream()[Symbol.asyncIterator]();
        let total = 0;
        try {
          for (;;) {
            const next = await iterator.next();
            if (next.done) return;
            const chunk = next.value;
            total += chunk.byteLength;
            if (total > maxSize) {
              file.cancel();
              throw new WireError(
                'CONTRACT_MISMATCH',
                `Upload file size exceeded maximum ${maxSize}`
              );
            }
            yield chunk;
          }
        } finally {
          await iterator.return?.();
        }
      })();
    },
    async bytes() {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of this.stream()) {
        chunks.push(chunk);
        total += chunk.byteLength;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    },
  };
}

function validateUploadFileEnvelope(def: UploadFileEndpointDef, file: WireFile): void {
  if (def.accept && !def.accept.includes(file.mimeType)) {
    throw new WireError(
      'CONTRACT_MISMATCH',
      `Upload file MIME type '${file.mimeType}' is not accepted`
    );
  }
  if (def.maxSize !== undefined && file.size !== undefined && file.size > def.maxSize) {
    throw new WireError(
      'CONTRACT_MISMATCH',
      `Upload file size ${file.size} exceeds maximum ${def.maxSize}`
    );
  }
}

export { encodeTopic, splitTopic } from './topics';

function createLiveLogResolver(
  impl: LiveLogEntryImpl<EndpointDef>
): (key: unknown) => LiveSource | null | undefined {
  if (isLiveLogReplica(impl)) return (key) => impl.resolve(key as never);
  if (isLiveLogClientHandle(impl)) return (key) => impl.handle(key as never).asLiveSource();
  return impl as (key: unknown) => LiveSource | null | undefined;
}

function createLiveJob(
  def: LiveJobEndpointDef,
  impl: JobImpl<LiveJobEndpointDef>,
  validate: ValidatePolicy
): LiveJob<unknown, unknown, unknown, unknown> {
  return new LiveJob<unknown, unknown, unknown, unknown>(
    async (input, ctx) => {
      const result = await impl.run(input, {
        jobId: ctx.jobId,
        signal: ctx.signal,
        progress: (progress) =>
          ctx.progress(validate === 'full' ? def.progress.parse(progress) : progress),
      });
      if (validate !== 'full') return result;
      return resultSchema(def.result, def.error).parse(result) as Result<unknown, unknown>;
    },
    {
      toError: impl.toError
        ? (error) => {
            const mapped = impl.toError?.(error);
            return validate === 'full' ? def.error.parse(mapped) : mapped;
          }
        : undefined,
    }
  );
}

function parseGroupMutationInput(
  group: LiveModelDef,
  def: MutationDef,
  input: unknown,
  validate: ValidatePolicy
): { key: unknown; input: Record<string, unknown>; mutationId: string } {
  const envelope = input as { key?: unknown; input?: unknown; mutationId?: unknown };
  const key = validate === 'none' ? envelope.key : group.keySchema.parse(envelope.key);
  const parsedInput = validate === 'none' ? envelope.input : def.input.parse(envelope.input);
  return {
    key,
    input: (parsedInput ?? {}) as Record<string, unknown>,
    mutationId: typeof envelope.mutationId === 'string' ? envelope.mutationId : createMutationId(),
  };
}

function validateMutationOutput(
  def: MutationDef,
  output: LiveMutationResult<unknown, unknown>,
  validate: ValidatePolicy
): LiveMutationResult<unknown, unknown> {
  if (validate !== 'full') return output;
  return resultSchema(
    z.object({ data: def.data, cursors: z.array(liveCursorEntrySchema) }),
    def.error
  ).parse(output) as LiveMutationResult<unknown, unknown>;
}

function missingLiveSource(message: string): LiveSource {
  return {
    snapshot() {
      throw new WireError('NOT_FOUND', message);
    },
    subscribe(): Unsubscribe {
      return () => {};
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

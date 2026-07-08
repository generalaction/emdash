import { err, ok, resultSchema, type Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import { LiveJobServer, type LiveJobContext } from '../live/job';
import {
  GroupMutationContext,
  isLiveModelHost,
  type LiveModelHost,
  MutationResultCache,
  createMutationId,
  type MutationResultCacheOptions,
  type LiveMutationResult,
} from '../live/mutations';
import { stableStringify } from '../live/mutations';
import type { LiveSource } from '../live/protocol';
import { liveCursorEntrySchema } from '../live/protocol';
import type { WireInstrumentation } from '../observability';
import type {
  Contract,
  ContractDefinitions,
  EndpointDef,
  EndpointInput,
  EndpointOutput,
  EndpointLiveModelKey,
  LiveLogKey,
  JobEndpointDef,
  JobInput,
  JobProgress,
  JobResult,
  JobError,
  LiveModelEndpointDef,
  LiveModelGroupDef,
  MutationDef,
} from './define';
import { isEndpointDef } from './define';
import { WireError } from './protocol';

export type CallMeta = {
  signal?: AbortSignal;
};

export type Controller = {
  call(path: string, input: unknown, meta?: CallMeta): Promise<unknown>;
  resolveLive(topic: string): LiveSource | null;
  liveRefIds(): readonly string[] | 'dynamic';
  dispose?(): void;
};

export type ValidatePolicy = 'none' | 'inputs' | 'full';

type ProcedureImpl<Def extends EndpointDef> = (
  input: EndpointInput<Def>,
  meta: CallMeta
) => Promise<EndpointOutput<Def>> | EndpointOutput<Def>;

type LiveModelImpl<Def extends LiveModelEndpointDef> = (
  key: EndpointLiveModelKey<Def>
) => LiveSource | null | undefined;

type LiveLogImpl<Def extends EndpointDef> = (key: LiveLogKey<Def>) => LiveSource | null | undefined;

type GroupImpl<Def extends LiveModelGroupDef> = LiveModelHost<Def>;

type EndpointImpl<Def extends EndpointDef> = Def extends { kind: 'procedure' }
  ? ProcedureImpl<Def>
  : Def extends LiveModelEndpointDef
    ? LiveModelImpl<Def>
    : Def extends { kind: 'liveLog' }
      ? LiveLogImpl<Def>
      : Def extends LiveModelGroupDef
        ? GroupImpl<Def>
        : Def extends JobEndpointDef
          ? JobImpl<Def>
          : never;

type JobImpl<Def extends JobEndpointDef> = {
  run(
    input: JobInput<Def>,
    ctx: LiveJobContext<JobProgress<Def>>
  ): Promise<JobResult<Def>> | JobResult<Def>;
  toError(error: unknown): JobError<Def>;
};

export type ContractImpl<Defs extends ContractDefinitions> = {
  [Name in keyof Defs]?: Defs[Name] extends EndpointDef
    ? EndpointImpl<Defs[Name]>
    : Defs[Name] extends Contract<infer Nested>
      ? ContractImpl<Nested>
      : never;
};

export type BindContractOptions = {
  validate?: ValidatePolicy;
  mutationDedupe?: MutationResultCacheOptions | false;
  instrumentation?: WireInstrumentation;
};

type LiveEntry = {
  keySchema: z.ZodTypeAny;
  resolve(key: unknown): LiveSource | null | undefined;
};

const jobKeySchema = z.object({ jobId: z.string() });

export function bindContract<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  impl: ContractImpl<Defs>,
  options: BindContractOptions = {}
): Controller {
  const validate = options.validate ?? 'none';
  const liveEntries = new Map<string, LiveEntry>();
  const procedureEntries = new Map<string, (input: unknown, meta: CallMeta) => Promise<unknown>>();
  const jobServers: Array<{ dispose(): void }> = [];
  const mutationCache =
    options.mutationDedupe === false ? undefined : new MutationResultCache(options.mutationDedupe);

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
        case 'liveModel': {
          const impl = entryImpl as LiveModelImpl<LiveModelEndpointDef> | undefined;
          if (!impl) {
            throw new WireError('MISSING_HANDLER', `Live model '${fullPath}' requires a resolver`);
          }
          liveEntries.set(def.id, {
            keySchema: def.keySchema,
            resolve: impl as (key: unknown) => LiveSource | null,
          });
          break;
        }
        case 'liveLog': {
          const impl = entryImpl as LiveLogImpl<EndpointDef> | undefined;
          if (!impl) {
            throw new WireError('MISSING_HANDLER', `Live log '${fullPath}' requires a resolver`);
          }
          liveEntries.set(def.id, {
            keySchema: def.keySchema,
            resolve: impl as (key: unknown) => LiveSource | null,
          });
          break;
        }
        case 'job': {
          const impl = entryImpl as JobImpl<JobEndpointDef> | undefined;
          if (!impl) {
            throw new WireError('MISSING_HANDLER', `Job '${fullPath}' requires a handler`);
          }
          const server = createJobServer(def, impl, validate);
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
            resolve: (key) => server.job((key as { jobId: string }).jobId),
          });
          break;
        }
        case 'group': {
          if (!isLiveModelHost(entryImpl)) {
            throw new WireError('MISSING_HANDLER', `Group '${fullPath}' requires a LiveModelHost`);
          }
          const host = entryImpl as LiveModelHost<LiveModelGroupDef>;
          if (host.contract.id !== def.id) {
            throw new WireError(
              'CONTRACT_MISMATCH',
              `Live model host for '${fullPath}' was created for '${host.contract.id}'`
            );
          }
          for (const [modelName, model] of Object.entries(def.models)) {
            liveEntries.set(model.id, {
              keySchema: def.keySchema,
              resolve: (key) => host.get(key as never)?.models[modelName],
            });
          }
          for (const [mutationName, mutationDef] of Object.entries(def.mutations)) {
            const handler = mutationDef.handler ?? host.mutationHandler(mutationName);
            if (!handler) {
              throw new WireError(
                'MISSING_HANDLER',
                `Mutation '${fullPath}.${mutationName}' requires a handler`
              );
            }
            procedureEntries.set(`${fullPath}.${mutationName}`, async (input) => {
              const envelope = parseGroupMutationInput(def, mutationDef, input, validate);
              const instance = host.get(envelope.key as never);
              if (!instance) {
                throw new WireError('NOT_FOUND', `Unknown group instance '${fullPath}'`);
              }
              const ctx = new GroupMutationContext(
                def,
                envelope.key,
                instance,
                envelope.mutationId
              );
              const output = await runMutation(
                mutationCache,
                envelope.mutationId,
                `${fullPath}.${mutationName}`,
                async () => {
                  const result = await handler(ctx, {
                    ...envelope.input,
                    mutationId: envelope.mutationId,
                  });
                  return result.success
                    ? ok({ data: result.data, cursors: ctx.cursors() })
                    : err(result.error);
                },
                options.instrumentation
              );
              return validateMutationOutput(mutationDef, output, validate);
            });
          }
          break;
        }
      }
    }
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
    liveRefIds() {
      return [...liveEntries.keys()];
    },
    dispose() {
      mutationCache?.clear();
      for (const server of jobServers) server.dispose();
    },
  };
}

export const bind = bindContract;

export function encodeTopic(refId: string, key: unknown): string {
  if (key === undefined) return refId;
  return `${refId}|${stableStringify(key)}`;
}

export function splitTopic(topic: string): { refId: string; rawKey: unknown } {
  const index = topic.indexOf('|');
  if (index === -1) return { refId: topic, rawKey: undefined };
  const encoded = topic.slice(index + 1);
  return {
    refId: topic.slice(0, index),
    rawKey: encoded.length === 0 ? undefined : JSON.parse(encoded),
  };
}

export function mergeControllers(controllers: Record<string, Controller>): Controller {
  const refOwners = new Map<string, string>();
  const dynamicControllers: Controller[] = [];
  for (const [namespace, controller] of Object.entries(controllers)) {
    const liveRefIds = controller.liveRefIds();
    if (liveRefIds === 'dynamic') {
      dynamicControllers.push(controller);
      continue;
    }
    for (const refId of liveRefIds) {
      const owner = refOwners.get(refId);
      if (owner) {
        throw new WireError(
          'DUPLICATE_LIVE_REF',
          `Live ref '${refId}' is registered by both '${owner}' and '${namespace}'`
        );
      }
      refOwners.set(refId, namespace);
    }
  }

  return {
    async call(path, input, meta = {}) {
      const index = path.indexOf('.');
      if (index === -1) {
        throw new WireError('UNKNOWN_PROCEDURE', `Unknown procedure '${path}'`);
      }
      const namespace = path.slice(0, index);
      const child = controllers[namespace];
      if (!child) {
        throw new WireError('UNKNOWN_PROCEDURE', `Unknown procedure '${path}'`);
      }
      return await child.call(path.slice(index + 1), input, meta);
    },
    resolveLive(topic) {
      const { refId } = splitTopic(topic);
      const owner = refOwners.get(refId);
      if (owner) return controllers[owner]?.resolveLive(topic) ?? null;
      for (const controller of dynamicControllers) {
        const source = controller.resolveLive(topic);
        if (source) return source;
      }
      return null;
    },
    liveRefIds() {
      if (dynamicControllers.length > 0) return 'dynamic';
      return [...refOwners.keys()];
    },
    dispose() {
      for (const controller of Object.values(controllers)) controller.dispose?.();
    },
  };
}

function createJobServer(
  def: JobEndpointDef,
  impl: JobImpl<JobEndpointDef>,
  validate: ValidatePolicy
): LiveJobServer<unknown, unknown, unknown, unknown> {
  return new LiveJobServer<unknown, unknown, unknown, unknown>(
    async (input, ctx) => {
      const result = await impl.run(input, {
        signal: ctx.signal,
        progress: (progress) =>
          ctx.progress(validate === 'full' ? def.progress.parse(progress) : progress),
      });
      return validate === 'full' ? def.result.parse(result) : result;
    },
    (error) => {
      const mapped = impl.toError(error);
      return validate === 'full' ? def.error.parse(mapped) : mapped;
    }
  );
}

function parseGroupMutationInput(
  group: LiveModelGroupDef,
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

function runMutation<D, E>(
  cache: MutationResultCache | undefined,
  mutationId: string,
  path: string,
  execute: () => Promise<LiveMutationResult<D, E>>,
  instrumentation: WireInstrumentation | undefined
): Promise<LiveMutationResult<D, E>> {
  return cache
    ? cache.run(mutationId, execute, {
        onDedupe: () => instrumentation?.mutationDeduped?.({ mutationId, path }),
      })
    : execute();
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

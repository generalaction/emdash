import { resultSchema, type Result } from '@emdash/shared';
import type { z } from 'zod';
import type { Mutator } from '../live/model';
import type { LiveModelRef } from '../live/mutations/model-ref';
import type { LiveMutationInput } from '../live/mutations/types';

export const contractSymbol: unique symbol = Symbol('wire.contract');

export type ProcedureDef<
  InputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: 'procedure';
  input: InputSchema;
  output: OutputSchema;
};

export type LiveModelEndpointDef<
  Id extends string = string,
  KeySchema extends z.ZodTypeAny = z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = LiveModelRef<Id, KeySchema, DataSchema> & {
  kind: 'liveModel';
};

export type LiveLogEndpointDef<
  Id extends string = string,
  KeySchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: 'liveLog';
  id: Id;
  keySchema: KeySchema;
};

export type JobEndpointDef<
  Id extends string = string,
  InputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  ProgressSchema extends z.ZodTypeAny = z.ZodTypeAny,
  ResultSchema extends z.ZodTypeAny = z.ZodTypeAny,
  ErrorSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: 'job';
  id: Id;
  input: InputSchema;
  progress: ProgressSchema;
  result: ResultSchema;
  error: ErrorSchema;
};

export type MutationDef<
  InputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny = z.ZodTypeAny,
  ErrorSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: 'mutation';
  input: InputSchema;
  data: DataSchema;
  error: ErrorSchema;
  handler?: GroupMutationHandler<InputSchema, DataSchema, ErrorSchema>;
};

export type GroupMutationHandler<
  InputSchema extends z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny,
  ErrorSchema extends z.ZodTypeAny,
> = (
  ctx: GroupMutationCtx<LiveModelGroupDef>,
  input: LiveMutationInput<z.infer<InputSchema>>
) =>
  | Promise<Result<z.infer<DataSchema>, z.infer<ErrorSchema>>>
  | Result<z.infer<DataSchema>, z.infer<ErrorSchema>>;

export type LiveModelGroupDef<
  KeySchema extends z.ZodTypeAny = z.ZodTypeAny,
  Models extends Record<string, LiveModelEndpointDef> = Record<string, LiveModelEndpointDef>,
  Mutations extends Record<string, MutationDef> = Record<string, MutationDef>,
> = {
  kind: 'group';
  id: string;
  keySchema: KeySchema;
  models: Models;
  mutations: Mutations;
};

export type EndpointDef = ProcedureDef | LiveLogEndpointDef | JobEndpointDef | LiveModelGroupDef;

export type ContractEntry = EndpointDef | Contract<ContractDefinitions>;
export interface ContractDefinitions {
  [key: string]: ContractEntry;
}
export type Contract<Defs extends ContractDefinitions> = Defs & {
  readonly [contractSymbol]: true;
};

export type EndpointInput<Def> =
  Def extends ProcedureDef<infer Input, z.ZodTypeAny> ? z.infer<Input> : never;

export type EndpointOutput<Def> =
  Def extends ProcedureDef<z.ZodTypeAny, infer Output> ? z.infer<Output> : never;

export type MutationInput<Def> =
  Def extends MutationDef<infer Input, z.ZodTypeAny, z.ZodTypeAny> ? z.infer<Input> : never;

export type MutationData<Def> =
  Def extends MutationDef<z.ZodTypeAny, infer Data, z.ZodTypeAny> ? z.infer<Data> : never;

export type MutationError<Def> =
  Def extends MutationDef<z.ZodTypeAny, z.ZodTypeAny, infer Error> ? z.infer<Error> : never;

export type EndpointLiveModelKey<Def> =
  Def extends LiveModelEndpointDef<string, infer Key, z.ZodTypeAny> ? z.infer<Key> : never;

export type EndpointLiveModelData<Def> =
  Def extends LiveModelEndpointDef<string, z.ZodTypeAny, infer Data> ? z.infer<Data> : never;

export type LiveLogKey<Def> =
  Def extends LiveLogEndpointDef<string, infer Key> ? z.infer<Key> : never;

export type JobInput<Def> =
  Def extends JobEndpointDef<string, infer Input, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>
    ? z.infer<Input>
    : never;

export type JobProgress<Def> =
  Def extends JobEndpointDef<string, z.ZodTypeAny, infer Progress, z.ZodTypeAny, z.ZodTypeAny>
    ? z.infer<Progress>
    : never;

export type JobResult<Def> =
  Def extends JobEndpointDef<string, z.ZodTypeAny, z.ZodTypeAny, infer Result, z.ZodTypeAny>
    ? z.infer<Result>
    : never;

export type JobError<Def> =
  Def extends JobEndpointDef<string, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny, infer Error>
    ? z.infer<Error>
    : never;

export type GroupKey<Def> =
  Def extends LiveModelGroupDef<
    infer Key,
    Record<string, LiveModelEndpointDef>,
    Record<string, MutationDef>
  >
    ? z.infer<Key>
    : never;

export type GroupModels<Def> =
  Def extends LiveModelGroupDef<z.ZodTypeAny, infer Models, Record<string, MutationDef>>
    ? Models
    : never;

export type GroupMutations<Def> =
  Def extends LiveModelGroupDef<z.ZodTypeAny, Record<string, LiveModelEndpointDef>, infer Mutations>
    ? Mutations
    : never;

export interface GroupMutationCtx<Group extends LiveModelGroupDef = LiveModelGroupDef> {
  readonly mutationId: string;
  readonly key: GroupKey<Group>;
  produce<Name extends keyof GroupModels<Group>>(
    name: Name,
    mutator: Mutator<EndpointLiveModelData<GroupModels<Group>[Name]>>
  ): void;
}

export function procedure<
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny,
>(def: { input: InputSchema; output: OutputSchema }): ProcedureDef<InputSchema, OutputSchema> {
  return { kind: 'procedure', ...def };
}

export function fallible<
  InputSchema extends z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny,
  ErrorSchema extends z.ZodTypeAny,
>(def: {
  input: InputSchema;
  data: DataSchema;
  error: ErrorSchema;
}): ProcedureDef<InputSchema, ReturnType<typeof resultSchema<DataSchema, ErrorSchema>>> {
  return procedure({
    input: def.input,
    output: resultSchema(def.data, def.error),
  });
}

export function liveLog<KeySchema extends z.ZodTypeAny>(def: {
  key: KeySchema;
}): LiveLogEndpointDef<string, KeySchema> {
  return { kind: 'liveLog', id: '', keySchema: def.key };
}

export function job<
  InputSchema extends z.ZodTypeAny,
  ProgressSchema extends z.ZodTypeAny,
  ResultSchema extends z.ZodTypeAny,
  ErrorSchema extends z.ZodTypeAny,
>(def: {
  input: InputSchema;
  progress: ProgressSchema;
  result: ResultSchema;
  error: ErrorSchema;
}): JobEndpointDef<string, InputSchema, ProgressSchema, ResultSchema, ErrorSchema> {
  return { kind: 'job', id: '', ...def };
}

/**
 * Defines a live model contract member mutation. Handlers should be pure functions
 * of the member drafts and input. The optimistic group utility may run the same
 * handler client-side to derive previews before the server confirms them.
 */
export function mutation<
  InputSchema extends z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny,
  ErrorSchema extends z.ZodTypeAny,
>(
  def: { input: InputSchema; data: DataSchema; error: ErrorSchema },
  handler: GroupMutationHandler<InputSchema, DataSchema, ErrorSchema>
): MutationDef<InputSchema, DataSchema, ErrorSchema>;
export function mutation<
  InputSchema extends z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny,
  ErrorSchema extends z.ZodTypeAny,
>(def: {
  input: InputSchema;
  data: DataSchema;
  error: ErrorSchema;
}): MutationDef<InputSchema, DataSchema, ErrorSchema>;
export function mutation(
  def: { input: z.ZodTypeAny; data: z.ZodTypeAny; error: z.ZodTypeAny },
  handler?: GroupMutationHandler<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>
): MutationDef {
  return { kind: 'mutation', ...def, handler };
}

export function defineLiveModelContract<
  KeySchema extends z.ZodTypeAny,
  Models extends Record<string, z.ZodTypeAny>,
  Mutations extends Record<string, MutationDef> = {},
>(def: {
  key: KeySchema;
  models: Models;
  mutations?: Mutations;
}): LiveModelGroupDef<
  KeySchema,
  {
    [Name in keyof Models]: LiveModelEndpointDef<string, KeySchema, Models[Name]>;
  },
  Mutations
> {
  const models: Record<string, LiveModelEndpointDef> = {};
  for (const [name, data] of Object.entries(def.models)) {
    models[name] = {
      kind: 'liveModel',
      id: '',
      keySchema: def.key,
      dataSchema: data,
    };
  }
  return {
    kind: 'group',
    id: '',
    keySchema: def.key,
    models: models as {
      [Name in keyof Models]: LiveModelEndpointDef<string, KeySchema, Models[Name]>;
    },
    mutations: (def.mutations ?? {}) as Mutations,
  };
}

export function defineContract<const Defs extends ContractDefinitions>(
  definitions: Defs
): Contract<Defs> {
  return finalizeContract(definitions, []) as Contract<Defs>;
}

function finalizeContract(
  definitions: ContractDefinitions,
  prefix: string[]
): Contract<ContractDefinitions> {
  const finalized: ContractDefinitions = {};
  for (const [name, def] of Object.entries(definitions)) {
    if (isMutationDef(def)) {
      throw new Error(
        `Mutation '${[...prefix, name].join('.')}' must be declared inside defineLiveModelContract().mutations`
      );
    }
    finalized[name] = isEndpointDef(def)
      ? finalizeEndpoint([...prefix, name], def)
      : finalizeContract(def, [...prefix, name]);
  }
  Object.defineProperty(finalized, contractSymbol, {
    value: true,
    enumerable: false,
  });
  return finalized as Contract<ContractDefinitions>;
}

function finalizeEndpoint(path: string[], def: EndpointDef): EndpointDef {
  const id = path.join('.');
  switch (def.kind) {
    case 'liveLog':
      return { ...def, id };
    case 'job':
      return { ...def, id };
    case 'group':
      return finalizeGroupEndpoint(id, def);
    case 'procedure':
      return { ...def };
  }
}

function finalizeGroupEndpoint(id: string, def: LiveModelGroupDef): LiveModelGroupDef {
  const models: Record<string, LiveModelEndpointDef> = {};
  for (const [modelName, model] of Object.entries(def.models)) {
    models[modelName] = {
      ...model,
      id: `${id}.${modelName}`,
      keySchema: def.keySchema,
    };
  }
  const mutations: Record<string, MutationDef> = {};
  for (const [mutationName, memberMutation] of Object.entries(def.mutations)) {
    mutations[mutationName] = { ...memberMutation };
  }
  return {
    ...def,
    id,
    models,
    mutations,
  };
}

function isMutationDef(value: unknown): value is MutationDef {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'mutation'
  );
}

export function isEndpointDef(value: ContractEntry): value is EndpointDef {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  switch (kind) {
    case 'liveLog':
    case 'job':
    case 'group':
    case 'procedure':
      return true;
    default:
      return false;
  }
}

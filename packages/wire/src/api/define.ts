import type { z } from 'zod';
import type { LiveModelRef } from '../live/mutations';

export type ProcedureDef<
  InputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  input: InputSchema;
  output: OutputSchema;
};

export type ProcedureDefinitions = Record<string, ProcedureDef>;

export type LiveLogRef<
  Id extends string = string,
  KeySchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: 'log';
  id: Id;
  keySchema: KeySchema;
};

export type ContractShape = {
  procedures: ProcedureDefinitions;
  models: Record<string, LiveModelRef>;
  logs: Record<string, LiveLogRef>;
};

export type ProcedureInput<Def extends ProcedureDef> = z.infer<Def['input']>;
export type ProcedureOutput<Def extends ProcedureDef> = z.infer<Def['output']>;
export type LiveLogKey<Ref extends LiveLogRef> = z.infer<Ref['keySchema']>;

export function procedure<
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny,
>(def: { input: InputSchema; output: OutputSchema }): ProcedureDef<InputSchema, OutputSchema> {
  return def;
}

export function liveLogRef<Id extends string, KeySchema extends z.ZodTypeAny>(
  id: Id,
  keySchema: KeySchema
): LiveLogRef<Id, KeySchema> {
  return { kind: 'log', id, keySchema };
}

export function defineContract<const Contract extends ContractShape>(contract: Contract): Contract {
  return contract;
}

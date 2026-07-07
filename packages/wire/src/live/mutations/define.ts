import type { z } from 'zod';

export type LiveMutationDefinition<
  InputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  ErrorSchema extends z.ZodTypeAny = z.ZodTypeAny,
  DataSchema extends z.ZodTypeAny | undefined = z.ZodTypeAny | undefined,
> = {
  input: InputSchema;
  error: ErrorSchema;
  data?: DataSchema;
};

export type LiveMutationDefinitions = Record<string, LiveMutationDefinition>;

export type LiveMutationInput<Def extends LiveMutationDefinition> = z.infer<Def['input']>;

export type LiveMutationError<Def extends LiveMutationDefinition> = z.infer<Def['error']>;

export type LiveMutationData<Def extends LiveMutationDefinition> = Def extends {
  data: z.ZodType<infer Data>;
}
  ? Data
  : void;

export function defineLiveMutations<const Defs extends LiveMutationDefinitions>(defs: Defs): Defs {
  return defs;
}

import {
  runtimeResolveErrorSchema,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import type { Result } from '@emdash/shared';
import { procedure, type MutationDef } from '@emdash/wire';
import { z } from 'zod';

const runtimeResolveFailureSchema = z.object({
  success: z.literal(false),
  error: runtimeResolveErrorSchema,
});

type RuntimeFallibleResult<OutputSchema extends z.ZodTypeAny> =
  z.output<OutputSchema> extends Result<infer Data, infer Error>
    ? Result<Data, Error | RuntimeResolveError>
    : never;

export function runtimeFallibleProcedure<
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny,
>(input: InputSchema, output: OutputSchema) {
  // The schema validates either Result branch. Flatten the two failure branches in the public type
  // so handlers can return Result<Data, DomainError | RuntimeResolveError>.
  const result = z.union([output, runtimeResolveFailureSchema]) as z.ZodType<
    RuntimeFallibleResult<OutputSchema>
  >;
  return procedure({
    input,
    output: result,
  });
}

export function runtimeResolveErrorUnion<ErrorSchema extends z.ZodTypeAny>(error: ErrorSchema) {
  return z.union([error, runtimeResolveErrorSchema]);
}

type RuntimeFallibleMutation<Definition extends MutationDef> =
  Definition extends MutationDef<infer InputSchema, infer DataSchema, infer ErrorSchema>
    ? MutationDef<InputSchema, DataSchema, ReturnType<typeof runtimeResolveErrorUnion<ErrorSchema>>>
    : never;

export function runtimeFallibleMutations<Definitions extends Record<string, MutationDef>>(
  definitions: Definitions
): { [Name in keyof Definitions]: RuntimeFallibleMutation<Definitions[Name]> } {
  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      {
        ...definition,
        error: runtimeResolveErrorUnion(definition.error),
      },
    ])
  ) as { [Name in keyof Definitions]: RuntimeFallibleMutation<Definitions[Name]> };
}

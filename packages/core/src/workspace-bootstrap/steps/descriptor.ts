import type { z } from 'zod';

export type FailureClass = 'transient' | 'conflict' | 'permanent';

export type GenericBootstrapStep = {
  kind: string;
  args: unknown;
};

export type StepFacts = {
  created?: boolean;
  path?: string;
};

export type StepDescriptor<
  Kind extends string = string,
  ArgsSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: Kind;
  args: ArgsSchema;
  fatal: boolean;
  label(args: z.infer<ArgsSchema>): string;
  teardown?(args: z.infer<ArgsSchema>, facts: StepFacts): GenericBootstrapStep[];
};

export function defineStep<Kind extends string, ArgsSchema extends z.ZodTypeAny>(
  descriptor: StepDescriptor<Kind, ArgsSchema>
): StepDescriptor<Kind, ArgsSchema> {
  return descriptor;
}

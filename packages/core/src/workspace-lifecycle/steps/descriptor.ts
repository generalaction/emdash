import type { z } from 'zod';

export type FailureClass = 'transient' | 'conflict' | 'permanent';

export type StepFacts = {
  created?: boolean;
  path?: string;
};

export type StepFatality<Args = unknown> = boolean | ((args: Args) => boolean);

export type StepDescriptor<
  Kind extends string = string,
  ArgsSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  kind: Kind;
  args: ArgsSchema;
  fatal: StepFatality<z.infer<ArgsSchema>>;
  label(args: z.infer<ArgsSchema>): string;
};

export function defineStep<Kind extends string, ArgsSchema extends z.ZodTypeAny>(
  descriptor: StepDescriptor<Kind, ArgsSchema>
): StepDescriptor<Kind, ArgsSchema> {
  return descriptor;
}

export function resolveFatal<Descriptor extends StepDescriptor>(
  descriptor: Descriptor,
  args: z.infer<Descriptor['args']>
): boolean {
  return typeof descriptor.fatal === 'function' ? descriptor.fatal(args) : descriptor.fatal;
}

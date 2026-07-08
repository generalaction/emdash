import type { z } from 'zod';
import type { BootstrapError, BootstrapStepWarning } from '../api/schemas';
import type { FailureClass, StepDescriptor, StepFacts } from './descriptor';

export type StepCtx = {
  repoPath: string;
  worktreePoolPath: string;
  preservePatterns: string[];
  resolvedWorktreePath?: string;
  signal?: AbortSignal;
  emitOutput?: (chunk: string) => void;
};

export type StepOutcome =
  | {
      success: true;
      facts?: StepFacts;
      warnings?: BootstrapStepWarning[];
    }
  | {
      success: false;
      class: FailureClass;
      error: BootstrapError;
    };

export type StepImplementation<Descriptor extends StepDescriptor = StepDescriptor> = {
  descriptor: Descriptor;
  execute(args: z.infer<Descriptor['args']>, ctx: StepCtx): Promise<StepOutcome>;
};

export function implement<Descriptor extends StepDescriptor>(
  descriptor: Descriptor,
  execute: StepImplementation<Descriptor>['execute']
): StepImplementation<Descriptor> {
  return { descriptor, execute };
}

export function stepOk(
  data: {
    facts?: StepFacts;
    warnings?: BootstrapStepWarning[];
  } = {}
): StepOutcome {
  return { success: true, ...data };
}

export function stepErr(failureClass: FailureClass, error: BootstrapError): StepOutcome {
  return { success: false, class: failureClass, error };
}

export function stepWarning(type: string, message: string): BootstrapStepWarning {
  return { type, message };
}

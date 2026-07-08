import { err, ok, type Result } from '@emdash/shared';
import { createController } from '@emdash/wire';
import { workspaceBootstrapContract } from './api/contract';
import type {
  BootstrapError,
  BootstrapPlan,
  LenientBootstrapPlan,
  PlanRejection,
} from './api/schemas';
import { runBootstrapPlan } from './runner/runner';
import { bootstrapStepRegistry } from './steps/registry';

export function createWorkspaceBootstrapController() {
  return createController(
    workspaceBootstrapContract,
    {
      capabilities: () =>
        ({
          stepKinds: Object.keys(bootstrapStepRegistry),
        }) satisfies { stepKinds: string[] },
      validatePlan: (input) => {
        const validated = validateBootstrapPlan(input.plan);
        if (!validated.success) return validated;
        return ok({ stepCount: validated.data.steps.length });
      },
      bootstrap: {
        run: async (input, ctx) => {
          const plan = validateBootstrapPlan(input.plan);
          if (!plan.success) return err(planRejectionToBootstrapError(plan.error));

          const result = await runBootstrapPlan(plan.data, input.context, {
            signal: ctx.signal,
            onProgress: ctx.progress,
          });
          return result;
        },
        toError: toBootstrapError,
      },
    },
    { validate: 'full' }
  );
}

export function validateBootstrapPlan(
  plan: LenientBootstrapPlan
): Result<BootstrapPlan, PlanRejection> {
  const steps: BootstrapPlan['steps'] = [];

  for (const entry of plan.steps) {
    const implementation =
      bootstrapStepRegistry[entry.step.kind as keyof typeof bootstrapStepRegistry];
    if (!implementation) {
      return err({
        type: 'unsupported-step',
        kind: entry.step.kind,
        message: `Unsupported bootstrap step "${entry.step.kind}"`,
      });
    }

    const parsed = implementation.descriptor.args.safeParse(entry.step.args);
    if (!parsed.success) {
      return err({
        type: 'invalid-args',
        stepId: entry.id,
        stepKind: entry.step.kind,
        message: parsed.error.message,
      });
    }

    steps.push({
      id: entry.id,
      label: entry.label,
      step: {
        kind: entry.step.kind,
        args: parsed.data,
      },
    } as BootstrapPlan['steps'][number]);
  }

  return ok({ steps });
}

function planRejectionToBootstrapError(rejection: PlanRejection): BootstrapError {
  if (rejection.type === 'unsupported-step') {
    return {
      type: rejection.type,
      stepKind: rejection.kind,
      message: rejection.message,
    };
  }
  return {
    type: rejection.type,
    stepId: rejection.stepId,
    stepKind: rejection.stepKind,
    message: rejection.message,
  };
}

function toBootstrapError(error: unknown): BootstrapError {
  if (isBootstrapError(error)) return error;
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function isBootstrapError(error: unknown): error is BootstrapError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

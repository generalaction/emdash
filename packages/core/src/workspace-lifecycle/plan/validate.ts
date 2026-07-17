import { err, ok, type Result } from '@emdash/shared';
import type { BootstrapPlan, LenientBootstrapPlan, PlanRejection } from '../api/schemas';
import { bootstrapStepRegistry } from '../steps/registry';

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

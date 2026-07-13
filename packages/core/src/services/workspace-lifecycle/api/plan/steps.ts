import type {
  BootstrapPlan,
  PlannedBootstrapStep,
  BootstrapStepStatus,
  BootstrapStepView,
} from '@services/workspace-lifecycle/api/api/schemas';
import type { BootstrapStep } from '@services/workspace-lifecycle/api/steps/catalog';
import { descriptorFor } from '@services/workspace-lifecycle/api/steps/catalog';

export function createPlannedSteps(steps: BootstrapStep[]): PlannedBootstrapStep[] {
  const counts = new Map<string, number>();
  return steps.map((step) => {
    const index = (counts.get(step.kind) ?? 0) + 1;
    counts.set(step.kind, index);
    return {
      id: `${step.kind}:${index}`,
      label: labelForStep(step),
      step,
    };
  });
}

export function planToStepViews(
  plan: BootstrapPlan,
  status: BootstrapStepStatus = 'pending'
): BootstrapStepView[] {
  return plan.steps.map((entry) => ({
    id: entry.id,
    kind: entry.step.kind,
    label: entry.label,
    status,
  }));
}

export function labelForStep(step: BootstrapStep): string {
  const descriptor = descriptorFor(step.kind);
  return descriptor?.label(descriptor.args.parse(step.args)) ?? step.kind;
}

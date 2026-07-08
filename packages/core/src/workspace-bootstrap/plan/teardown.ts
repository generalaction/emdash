import type { BootstrapPlan, BootstrapStepReport } from '../api/schemas';
import { teardownStepsFor } from '../steps/catalog';
import { createPlannedSteps } from './steps';

export function compileTeardownPlan(report: BootstrapStepReport[]): BootstrapPlan {
  const steps = report
    .slice()
    .reverse()
    .flatMap((entry) => teardownStepsFor(entry.kind, entry.args, entry.facts));
  return { steps: createPlannedSteps(steps) };
}

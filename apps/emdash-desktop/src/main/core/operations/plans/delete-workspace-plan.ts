import type { LifecycleOperationRow } from '@main/db/schema';
import { workspaceInUseError } from '../operation-errors';
import type { OperationPlan } from '../operation-plan';
import type { WorkspaceOperationProbe } from './probe-workspace-state';
import { compileSessionKillSteps } from './session-kill-steps';

export function compileDeleteWorkspacePlan(
  probe: WorkspaceOperationProbe,
  operation: LifecycleOperationRow
): OperationPlan {
  if (probe.inUse) {
    return {
      kind: operation.kind,
      preconditionFailure: workspaceInUseError(),
    };
  }

  return {
    kind: operation.kind,
    steps: [
      ...compileSessionKillSteps(probe.sessionTargets),
      {
        id: 'teardown-workspace',
        kind: 'teardown-workspace',
        label: 'Remove workspace',
        destructive: true,
      },
      {
        id: 'purge-workspace-row',
        kind: 'purge-workspace-row',
        label: 'Remove workspace data',
        destructive: true,
      },
    ],
  };
}

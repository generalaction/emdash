import type { LifecycleOperationRow } from '@core/services/app-db/node/schema';
import type { ExecutableOperationPlan, OperationPlanStep } from '../operation-plan';
import type { TaskOperationProbe } from './probe-task-state';
import { compileSessionKillSteps } from './session-kill-steps';

export function compileDeleteTaskPlan(
  probe: TaskOperationProbe,
  operation: LifecycleOperationRow
): ExecutableOperationPlan {
  const steps: OperationPlanStep[] = compileSessionKillSteps(probe.sessionTargets);
  if (!probe.task) {
    return { kind: 'delete-task', steps };
  }
  if (probe.workspace?.path) {
    steps.push({
      id: 'deactivate-workspace',
      kind: 'deactivate-workspace',
      label: 'Deactivate workspace',
      destructive: !!probe.automation?.teardown,
    });
  }
  if (
    operation.payload.deleteWorktree !== false &&
    !probe.workspaceSharedWithLiveTasks &&
    (probe.workspace?.kind === 'worktree' || probe.workspace?.kind === 'byoi') &&
    probe.workspace.path
  ) {
    steps.push({
      id: 'teardown-workspace',
      kind: 'teardown-workspace',
      label: probe.workspace.kind === 'worktree' ? 'Remove worktree and branch' : 'Remove folder',
      destructive: true,
    });
  }
  steps.push({
    id: 'purge-task-rows',
    kind: 'purge-task-rows',
    label: 'Remove task data',
    destructive: true,
  });
  return { kind: 'delete-task', steps };
}

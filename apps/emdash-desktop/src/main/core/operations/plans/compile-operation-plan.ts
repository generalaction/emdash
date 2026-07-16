import type { LifecycleOperationRow } from '@main/db/schema';
import { resolveOperationContext } from '../operation-context';
import type { OperationPlan } from '../operation-plan';
import { resolveSessionTargets } from '../session-targets';
import { compileArchiveWorkspacePlan } from './archive-workspace-plan';
import { compileDeleteTaskPlan } from './delete-task-plan';
import { compileDeleteWorkspacePlan } from './delete-workspace-plan';
import { probeTaskState } from './probe-task-state';
import { probeWorkspaceState } from './probe-workspace-state';
import { compileSessionKillSteps } from './session-kill-steps';

export async function compileOperationPlan(
  operation: LifecycleOperationRow
): Promise<OperationPlan> {
  switch (operation.kind) {
    case 'delete-task':
      return compileDeleteTaskPlan(await probeTaskState(operation), operation);
    case 'delete-workspace': {
      const probe = await probeWorkspaceState(operation);
      return compileDeleteWorkspacePlan(probe, operation);
    }
    case 'archive-workspace': {
      const probe = await probeWorkspaceState(operation);
      return compileArchiveWorkspacePlan(probe, operation);
    }
    case 'delete-project':
      return {
        kind: operation.kind,
        steps: [
          {
            id: 'purge-project-row',
            kind: 'purge-project-row',
            label: 'Remove project data',
            destructive: true,
          },
        ],
      };
    case 'cleanup-sessions': {
      const context = await resolveOperationContext(operation);
      const targets = await resolveSessionTargets(operation, context);
      return {
        kind: operation.kind,
        steps: compileSessionKillSteps(targets),
      };
    }
  }
}

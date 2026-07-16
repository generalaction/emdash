import type { LifecycleOperationRow } from '@main/db/schema';
import type { ExecutableOperationPlan } from '../operation-plan';
import type { WorkspaceOperationProbe } from './probe-workspace-state';
import { compileSessionKillSteps } from './session-kill-steps';

export function compileArchiveWorkspacePlan(
  probe: WorkspaceOperationProbe,
  operation: LifecycleOperationRow
): ExecutableOperationPlan {
  const workspaceSteps = probe.context.workspacePath
    ? [
        {
          id: 'deactivate-workspace',
          kind: 'deactivate-workspace' as const,
          label: 'Deactivate workspace',
          destructive: !!probe.context.automation?.teardown,
        },
        {
          id: 'clean-artifacts',
          kind: 'clean-artifacts' as const,
          label: 'Remove ignored artifacts',
          destructive: true,
        },
      ]
    : [];

  return {
    kind: operation.kind,
    steps: [
      ...compileSessionKillSteps(probe.sessionTargets),
      ...workspaceSteps,
      {
        id: 'purge-workspace-row',
        kind: 'purge-workspace-row',
        label: 'Remove workspace data',
        destructive: true,
      },
    ],
  };
}

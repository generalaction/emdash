import type { LifecycleOperationRow } from '@main/db/schema';
import type { OperationPlan } from '../operation-plan';
import { compileDeleteTaskPlan } from './delete-task-plan';
import { probeTaskState } from './probe-task-state';

export async function compileOperationPlan(
  operation: LifecycleOperationRow
): Promise<OperationPlan> {
  switch (operation.kind) {
    case 'delete-task':
      return compileDeleteTaskPlan(await probeTaskState(operation), operation);
    case 'delete-workspace':
      return {
        kind: operation.kind,
        steps: [
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
    case 'cleanup-sessions':
      return {
        kind: operation.kind,
        steps: [
          ...(operation.payload.acpConversationIds?.length
            ? [
                {
                  id: 'kill-acp-sessions',
                  kind: 'kill-acp-sessions' as const,
                  label: 'Stop ACP sessions',
                  destructive: false,
                },
              ]
            : []),
          ...(operation.payload.tuiConversationIds?.length ||
          operation.payload.terminalSessionIds?.length ||
          operation.payload.tmuxSessionNames?.length
            ? [
                {
                  id: 'kill-tui-sessions',
                  kind: 'kill-tui-sessions' as const,
                  label: 'Stop terminal sessions',
                  destructive: false,
                },
              ]
            : []),
        ],
      };
  }
}

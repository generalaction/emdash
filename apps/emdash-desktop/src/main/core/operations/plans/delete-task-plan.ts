import type { LifecycleOperationRow } from '@main/db/schema';
import type { OperationPlan } from '../operation-plan';
import type { TaskOperationProbe } from './probe-task-state';

export function compileDeleteTaskPlan(
  probe: TaskOperationProbe,
  operation: LifecycleOperationRow
): OperationPlan {
  const steps: OperationPlan['steps'] = [];
  if (probe.acpConversationCount > 0 || operation.payload.acpConversationIds?.length) {
    steps.push({
      id: 'kill-acp-sessions',
      kind: 'kill-acp-sessions',
      label: 'Stop ACP sessions',
      destructive: false,
    });
  }
  if (
    probe.tuiConversationCount > 0 ||
    probe.terminalCount > 0 ||
    operation.payload.tuiConversationIds?.length ||
    operation.payload.terminalSessionIds?.length ||
    operation.payload.tmuxSessionNames?.length
  ) {
    steps.push({
      id: 'kill-tui-sessions',
      kind: 'kill-tui-sessions',
      label: 'Stop terminal sessions',
      destructive: false,
    });
  }
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
    probe.workspace?.kind === 'worktree' &&
    probe.workspace.path
  ) {
    steps.push({
      id: 'teardown-workspace',
      kind: 'teardown-workspace',
      label: 'Remove worktree and branch',
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

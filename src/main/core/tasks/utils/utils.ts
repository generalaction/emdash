import type { TaskRow } from '@main/db/schema';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import type { Task, TaskLifecycleStatus } from '@shared/core/tasks/tasks';

export function mapTaskRowToTask(
  row: TaskRow,
  prs: PullRequest[] = [],
  conversations: Record<string, number> = {}
): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status as TaskLifecycleStatus,
    linkedIssue: row.linkedIssue ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    lastInteractedAt: row.lastInteractedAt ?? undefined,
    createdAt: row.createdAt,
    prs,
    conversations,
    updatedAt: row.updatedAt,
    statusChangedAt: row.statusChangedAt,
    isPinned: row.isPinned === 1,
    workspaceId: row.workspaceId ?? undefined,
    type: (row.type as 'task' | 'automation-run') ?? 'task',
    automationRunId: row.automationRunId ?? undefined,
  };
}

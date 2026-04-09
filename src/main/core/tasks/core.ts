import { Issue, Task, TaskLifecycleStatus } from '@shared/tasks';
import { TaskRow } from '@main/db/schema';

export function mapTaskRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status as TaskLifecycleStatus,
    sourceBranch: row.sourceBranch,
    taskBranch: row.taskBranch ?? undefined,
    linkedIssue: row.linkedIssue ? (JSON.parse(row.linkedIssue) as Issue) : undefined,
    archivedAt: row.archivedAt ?? undefined,
    lastInteractedAt: row.lastInteractedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    statusChangedAt: row.statusChangedAt,
    isPinned: row.isPinned === 1,
  };
}

import { PullRequest } from '@shared/pull-requests';
import { Issue, Task, TaskLifecycleStatus } from '@shared/tasks';
import { TaskRow } from '@main/db/schema';
import { fromStoredBranch } from './stored-branch';

export function mapTaskRowToTask(
  row: TaskRow,
  prs: PullRequest[] = [],
  conversations: Record<string, number> = {}
): Task {
  const sourceBranch = fromStoredBranch(row.sourceBranch);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status as TaskLifecycleStatus,
    sourceBranch,
    taskBranch: row.taskBranch ?? undefined,
    linkedIssue: row.linkedIssue ? (JSON.parse(row.linkedIssue) as Issue) : undefined,
    archivedAt: row.archivedAt ?? undefined,
    lastInteractedAt: row.lastInteractedAt ?? undefined,
    createdAt: row.createdAt,
    prs,
    conversations,
    updatedAt: row.updatedAt,
    statusChangedAt: row.statusChangedAt,
    isPinned: row.isPinned === 1,
  };
}

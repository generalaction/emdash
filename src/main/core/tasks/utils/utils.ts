import type { TaskRow } from '@main/db/schema';
import type { PullRequest } from '@shared/pull-requests';
import type { Issue, Task, TaskKind, TaskLifecycleStatus } from '@shared/tasks';
import { fromStoredBranch } from '../stored-branch';

export function mapTaskRowToTask(
  row: TaskRow,
  prs: PullRequest[] = [],
  conversations: Record<string, number> = {}
): Task {
  const sourceBranch = row.sourceBranch ? fromStoredBranch(row.sourceBranch) : undefined;
  const kind = (row.kind === 'chat' ? 'chat' : 'task') satisfies TaskKind;
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    kind,
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
    workspaceId: row.workspaceId ?? undefined,
  };
}

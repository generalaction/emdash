import { and, eq, sql } from 'drizzle-orm';
import { taskPrUpdatedChannel, taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import type { PullRequest } from '@shared/pull-requests';
import type { TaskLifecycleStatus } from '@shared/tasks';
import { workspaceKey } from '@shared/workspace-key';
import { db } from '@main/db/client';
import { pullRequests, tasks, tasksPullRequests } from '@main/db/schema';
import { events } from '@main/lib/events';
import { prRowToPullRequest } from '../pull-requests/pr-utils';

function resolveNextStatus(
  prStatus: string,
  isDraft: boolean,
  currentStatus: TaskLifecycleStatus
): TaskLifecycleStatus | null {
  if (prStatus === 'open' && !isDraft && currentStatus === 'in_progress') return 'review';
  if (prStatus === 'merged' && currentStatus === 'review') return 'done';
  return null;
}

export async function onPrUpserted(pr: PullRequest, projectId: string): Promise<void> {
  const headBranch = pr.metadata.headRefName;
  if (!headBranch) return;

  const matchingTasks = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      status: tasks.status,
      taskBranch: tasks.taskBranch,
    })
    .from(tasks)
    .where(and(eq(tasks.taskBranch, headBranch), eq(tasks.projectId, projectId)));

  if (matchingTasks.length === 0) return;

  await db
    .insert(tasksPullRequests)
    .values(matchingTasks.map((t) => ({ taskId: t.id, pullRequestUrl: pr.url })))
    .onConflictDoNothing();

  for (const task of matchingTasks) {
    const linked = await db
      .select({ pr: pullRequests })
      .from(tasksPullRequests)
      .innerJoin(pullRequests, eq(pullRequests.url, tasksPullRequests.pullRequestUrl))
      .where(eq(tasksPullRequests.taskId, task.id));

    events.emit(taskPrUpdatedChannel, {
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: workspaceKey(task.taskBranch ?? undefined),
      prs: linked.map(({ pr: row }) => prRowToPullRequest(row)),
    });

    const next = resolveNextStatus(pr.status, pr.isDraft, task.status as TaskLifecycleStatus);
    if (!next) continue;
    await db
      .update(tasks)
      .set({ status: next, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tasks.id, task.id));
    events.emit(taskStatusUpdatedChannel, {
      taskId: task.id,
      projectId: task.projectId,
      status: next,
    });
  }
}

// ---------------------------------------------------------------------------
// Creation-time helpers — two-step: look up PR before task insert, link after
// ---------------------------------------------------------------------------

/**
 * Look up an existing PR for a branch before the task row is inserted.
 * Returns minimal fields needed to compute the initial status.
 */
export async function findPrForBranch(
  taskBranch: string,
  nameWithOwner: string
): Promise<{ url: string; status: string; isDraft: boolean } | null> {
  const [pr] = await db
    .select({
      url: pullRequests.url,
      status: pullRequests.status,
      isDraft: pullRequests.isDraft,
    })
    .from(pullRequests)
    .where(
      and(eq(pullRequests.headRefName, taskBranch), eq(pullRequests.nameWithOwner, nameWithOwner))
    )
    .limit(1);

  if (!pr) return null;
  return { url: pr.url, status: pr.status, isDraft: Boolean(pr.isDraft) };
}

/**
 * Write the tasks_pull_requests link after the task row exists.
 */
export async function linkTaskToPr(taskId: string, prUrl: string): Promise<void> {
  await db
    .insert(tasksPullRequests)
    .values({ taskId, pullRequestUrl: prUrl })
    .onConflictDoNothing();
}

/**
 * Resolve what initial status a task should have given an existing PR.
 */
export function resolveInitialStatus(pr: {
  status: string;
  isDraft: boolean;
}): TaskLifecycleStatus {
  if (pr.status === 'open' && !pr.isDraft) return 'review';
  return 'in_progress';
}

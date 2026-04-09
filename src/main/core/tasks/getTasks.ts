import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { PullRequest } from '@shared/pull-requests';
import { Task } from '@shared/tasks';
import { db } from '@main/db/client';
import { conversations, pullRequests, tasks, tasksPullRequests } from '@main/db/schema';
import { prRowToPullRequest } from '../pull-requests/pr-utils';
import { mapTaskRowToTask } from './core';

export async function getTasks(projectId?: string): Promise<Task[]> {
  const rows = projectId
    ? await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId)))
        .orderBy(desc(tasks.updatedAt))
    : await db.select().from(tasks).orderBy(desc(tasks.updatedAt));

  if (rows.length === 0) return [];

  const taskIds = rows.map((r) => r.id);

  const prRows = await db
    .select({ taskId: tasksPullRequests.taskId, pr: pullRequests })
    .from(tasksPullRequests)
    .innerJoin(pullRequests, eq(pullRequests.url, tasksPullRequests.pullRequestUrl))
    .where(inArray(tasksPullRequests.taskId, taskIds));

  const convRows = await db
    .select({
      taskId: conversations.taskId,
      provider: conversations.provider,
      count: count(),
    })
    .from(conversations)
    .where(inArray(conversations.taskId, taskIds))
    .groupBy(conversations.taskId, conversations.provider);

  const prsByTask = new Map<string, PullRequest[]>();
  for (const { taskId, pr } of prRows) {
    const list = prsByTask.get(taskId) ?? [];
    list.push(prRowToPullRequest(pr));
    prsByTask.set(taskId, list);
  }

  const convByTask = new Map<string, Record<string, number>>();
  for (const { taskId, provider, count: c } of convRows) {
    const rec = convByTask.get(taskId) ?? {};
    rec[provider ?? 'unknown'] = c;
    convByTask.set(taskId, rec);
  }

  return rows.map((row) => ({
    ...mapTaskRowToTask(row),
    prs: prsByTask.get(row.id) ?? [],
    conversations: convByTask.get(row.id) ?? {},
  }));
}

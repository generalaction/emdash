import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@main/db/client';
import { automationRuns, conversations, tasks, workspaces } from '@main/db/schema';
import { type Task } from '@shared/tasks';
import { mapTaskRowToTask } from '../utils/utils';

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

  const [convRows, automationRunRows] = await Promise.all([
    db
      .select({
        taskId: conversations.taskId,
        provider: conversations.provider,
        count: count(),
      })
      .from(conversations)
      .where(inArray(conversations.taskId, taskIds))
      .groupBy(conversations.taskId, conversations.provider),
    db
      .select({
        taskId: automationRuns.createdTaskId,
        automationId: automationRuns.automationId,
        runId: automationRuns.id,
      })
      .from(automationRuns)
      .where(inArray(automationRuns.createdTaskId, taskIds)),
  ]);

  const convByTask = new Map<string, Record<string, number>>();
  for (const { taskId, provider, count: c } of convRows) {
    const rec = convByTask.get(taskId) ?? {};
    rec[provider ?? 'unknown'] = c;
    convByTask.set(taskId, rec);
  }

  const automationByTask = new Map<string, string>();
  const runByTask = new Map<string, string>();
  for (const { taskId, automationId, runId } of automationRunRows) {
    if (taskId) {
      automationByTask.set(taskId, automationId);
      runByTask.set(taskId, runId);
    }
  }

  const wsIds = rows.map((r) => r.workspaceId).filter((id): id is string => id != null);
  const wsRows = wsIds.length
    ? await db
        .select({
          id: workspaces.id,
          linesAdded: workspaces.linesAdded,
          linesDeleted: workspaces.linesDeleted,
        })
        .from(workspaces)
        .where(inArray(workspaces.id, wsIds))
    : [];
  const wsByWsId = new Map(wsRows.map((r) => [r.id, r]));

  return rows.map((row) => {
    const ws = row.workspaceId ? wsByWsId.get(row.workspaceId) : undefined;
    return {
      ...mapTaskRowToTask(row),
      prs: [],
      conversations: convByTask.get(row.id) ?? {},
      automationId: automationByTask.get(row.id),
      runId: runByTask.get(row.id),
      workspaceGit:
        ws?.linesAdded != null
          ? { linesAdded: ws.linesAdded, linesDeleted: ws.linesDeleted ?? 0 }
          : undefined,
    };
  });
}

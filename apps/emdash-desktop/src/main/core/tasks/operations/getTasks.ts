import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { type Task } from '@core/primitives/tasks/api';
import { conversations, tasks, workspaces } from '@core/services/app-db/node/schema';
import { getRunProjectionsByRunIds } from '@main/core/automations/run-projection';
import { getAppDb } from '@main/db/instance';
import { mapAutomationRunRowToMeta, mapTaskRowToTask } from '../utils/utils';

export async function getTasks(projectId?: string): Promise<Task[]> {
  const rows = projectId
    ? await getAppDb()
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.updatedAt))
    : await getAppDb()
        .select()
        .from(tasks)
        .where(isNull(tasks.deletedAt))
        .orderBy(desc(tasks.updatedAt));

  if (rows.length === 0) return [];

  const taskIds = rows.map((r) => r.id);
  const runIds = rows.flatMap((row) => (row.automationRunId ? [row.automationRunId] : []));

  const convRows = await getAppDb()
    .select({
      taskId: conversations.taskId,
      provider: conversations.provider,
      count: count(),
    })
    .from(conversations)
    .where(inArray(conversations.taskId, taskIds))
    .groupBy(conversations.taskId, conversations.provider);

  const convByTask = new Map<string, Record<string, number>>();
  for (const { taskId, provider, count: c } of convRows) {
    const rec = convByTask.get(taskId) ?? {};
    rec[provider ?? 'unknown'] = c;
    convByTask.set(taskId, rec);
  }

  const wsIds = rows.map((r) => r.workspaceId).filter((id): id is string => id != null);
  const wsRows = wsIds.length
    ? await getAppDb()
        .select({
          id: workspaces.id,
          linesAdded: workspaces.linesAdded,
          linesDeleted: workspaces.linesDeleted,
        })
        .from(workspaces)
        .where(and(inArray(workspaces.id, wsIds), isNull(workspaces.deletedAt)))
    : [];
  const wsByWsId = new Map(wsRows.map((r) => [r.id, r]));
  const runProjections = await getRunProjectionsByRunIds(runIds);
  const runMetaByRunId = new Map(
    runProjections.map((row) => [row.id, mapAutomationRunRowToMeta(row)])
  );

  return rows.map((row) => {
    const ws = row.workspaceId ? wsByWsId.get(row.workspaceId) : undefined;
    return {
      ...mapTaskRowToTask(
        row,
        [],
        convByTask.get(row.id) ?? {},
        row.automationRunId ? runMetaByRunId.get(row.automationRunId) : undefined
      ),
      workspaceGit:
        ws?.linesAdded != null
          ? { linesAdded: ws.linesAdded, linesDeleted: ws.linesDeleted ?? 0 }
          : undefined,
    };
  });
}

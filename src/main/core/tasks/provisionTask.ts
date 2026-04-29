import { eq, sql } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { formatProvisionTaskError } from '@main/core/tasks/provision-task-error';
import { taskManager } from '@main/core/tasks/task-manager';
import { mapTerminalRowToTerminal } from '@main/core/terminals/core';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { conversations, tasks, terminals } from '@main/db/schema';
import { capture } from '@main/lib/telemetry';
import { mapTaskRowToTask } from './utils/utils';

export async function provisionTask(taskId: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!row) throw new Error(`Task not found: ${taskId}`);

  const task = mapTaskRowToTask(row);
  const project = projectManager.getProject(task.projectId);
  if (!project) throw new Error(`Project not found: ${task.projectId}`);

  const existingTask = taskManager.getTask(taskId);

  if (existingTask) {
    const wsId = taskManager.getWorkspaceId(taskId) ?? '';
    return {
      path: workspaceRegistry.get(wsId)?.path ?? '',
      workspaceId: wsId,
      sshConnectionId: undefined,
    };
  }

  const [existingTerminals, existingConversations] = await Promise.all([
    db
      .select()
      .from(terminals)
      .where(eq(terminals.taskId, taskId))
      .then((rows) => rows.map(mapTerminalRowToTerminal)),
    db
      .select()
      .from(conversations)
      .where(eq(conversations.taskId, taskId))
      .then((rows) => rows.map((r) => mapConversationRowToConversation(r, true))),
  ]);

  const result = await taskManager.provisionTask(
    project,
    task,
    existingConversations,
    existingTerminals
  );
  if (!result.success) {
    throw new Error(`Failed to provision task: ${formatProvisionTaskError(result.error)}`);
  }

  const { persistData } = result.data;

  await db
    .update(tasks)
    .set({
      lastInteractedAt: sql`CURRENT_TIMESTAMP`,
      workspaceId: persistData.workspaceId,
      workspaceProviderData: persistData.workspaceProviderData
        ? JSON.stringify(persistData.workspaceProviderData)
        : null,
    })
    .where(eq(tasks.id, taskId));
  capture('task_provisioned', {
    project_id: task.projectId,
    task_id: task.id,
  });

  return {
    path: workspaceRegistry.get(persistData.workspaceId)?.path ?? '',
    workspaceId: persistData.workspaceId,
    sshConnectionId: persistData.sshConnectionId,
  };
}

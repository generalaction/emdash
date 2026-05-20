import { eq, sql } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { formatProvisionTaskError } from '@main/core/tasks/provision-task-error';
import { taskManager, type WorkspaceHint } from '@main/core/tasks/task-manager';
import { mapTerminalRowToTerminal } from '@main/core/terminals/core';
import { workspaceBootstrapService } from '@main/core/workspaces/workspace-bootstrap-service';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { conversations, tasks, terminals, workspaces } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { mapTaskRowToTask } from './utils/utils';

export async function provisionTask(taskId: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!row) throw new Error(`Task not found: ${taskId}`);

  const task = mapTaskRowToTask(row);
  const project = projectManager.getProject(task.projectId);
  if (!project) throw new Error(`Project not found: ${task.projectId}`);

  const existingTask = taskManager.getTask(taskId);

  if (existingTask) {
    const persistData = taskManager.getPersistData(taskId);
    const wsId = persistData?.workspaceId ?? '';
    return {
      path: workspaceRegistry.get(wsId)?.path ?? '',
      workspaceId: wsId,
      sshConnectionId: persistData?.sshConnectionId,
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

  if (!row.workspaceId) throw new Error(`Task ${taskId} has no workspace — cannot provision`);

  const workspaceRow = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .then((r) => r[0]);

  if (!workspaceRow) throw new Error(`Workspace ${row.workspaceId} not found for task ${taskId}`);

  const hint: WorkspaceHint = {
    id: workspaceRow.id,
    type: workspaceRow.type,
    path: workspaceRow.path ?? undefined,
  };

  const result = await taskManager.provisionTask(
    project,
    task,
    existingConversations,
    existingTerminals,
    hint
  );
  if (!result.success) {
    throw new Error(`Failed to provision task: ${formatProvisionTaskError(result.error)}`);
  }

  const { persistData } = result.data;
  if (persistData.sshConnectionId) {
    sshConnectionManager.reportChannelRecovered(persistData.sshConnectionId);
  }

  const workspacePath = workspaceRegistry.get(persistData.workspaceId)?.path ?? '';

  await db
    .update(tasks)
    .set({ lastInteractedAt: sql`CURRENT_TIMESTAMP`, workspaceId: persistData.workspaceId })
    .where(eq(tasks.id, taskId));

  if (!workspaceRow.path && workspacePath) {
    const connectionId =
      project.defaultWorkspaceType.kind === 'ssh'
        ? project.defaultWorkspaceType.connectionId
        : undefined;
    await workspaceBootstrapService.persistPath(
      workspaceRow.id,
      workspacePath,
      workspaceRow.type,
      connectionId
    );
  }

  if (workspaceRow.type === 'byoi' && persistData.workspaceProviderData) {
    await db
      .update(workspaces)
      .set({
        data: JSON.stringify(persistData.workspaceProviderData),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(workspaces.id, workspaceRow.id));
  }

  telemetryService.capture('task_provisioned', {
    project_id: task.projectId,
    task_id: task.id,
  });

  return {
    path: workspacePath,
    workspaceId: persistData.workspaceId,
    sshConnectionId: persistData.sshConnectionId,
  };
}

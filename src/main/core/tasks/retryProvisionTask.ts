import { eq, sql } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { mapTerminalRowToTerminal } from '@main/core/terminals/core';
import { db } from '@main/db/client';
import { conversations, tasks, terminals } from '@main/db/schema';
import { mapTaskRowToTask } from './core';

export async function retryProvisionTask(taskId: string): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!row) throw new Error(`Task not found: ${taskId}`);

  const task = mapTaskRowToTask(row);
  const project = projectManager.getProject(task.projectId);
  if (!project) throw new Error(`Project not found: ${task.projectId}`);

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

  const result = await project.retryTaskProvision(task, existingConversations, existingTerminals);
  if (!result.success) throw new Error(`Failed to provision task: ${result.error.message}`);

  await db
    .update(tasks)
    .set({ lastInteractedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(tasks.id, taskId));
}

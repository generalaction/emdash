import { and, eq } from 'drizzle-orm';
import { acpSessionManager } from '@main/core/acp/acp-session-manager';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { mapConversationRowToConversation } from './utils';

export async function hydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);
  if (!row) throw new Error('Conversation not found');

  const conversation = mapConversationRowToConversation(row);

  if (conversation.type === 'acp') {
    if (acpSessionManager.isRunning(conversationId)) return;
    const workspaceId = taskSessionManager.getWorkspaceId(taskId);
    const workspace = workspaceId ? workspaceRegistry.get(workspaceId) : undefined;
    if (!workspace || !workspaceId) throw new Error('Workspace not found for ACP conversation');
    const config = row.config ?? {};
    await acpSessionManager.start(conversation, workspaceId, workspace.path, config.initialPrompt);
    return;
  }

  const task = resolveTask(projectId, taskId);
  if (!task) throw new Error('Task not found');

  const isFirstSpawn = row.sessionId === null;

  if (isFirstSpawn) {
    // Write session_id before spawning — idempotency guard against double-hydrate.
    await db
      .update(conversations)
      .set({ sessionId: conversationId })
      .where(eq(conversations.id, conversationId));
  }

  const config = row.config ?? {};
  const isResuming = !isFirstSpawn;

  await task.conversations.startSession(
    mapConversationRowToConversation(row, isResuming),
    undefined,
    isResuming,
    isFirstSpawn ? config.initialPrompt : undefined
  );
}

import { and, eq } from 'drizzle-orm';
import { acpSessionManager } from '@main/core/acp/production-acp-session-manager';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { taskSessionManager } from '../tasks/task-session-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
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
    if (!workspaceId) throw new Error('No workspace found for task');
    const workspace = workspaceRegistry.get(workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const config = row.config ?? {};
    await acpSessionManager.start(conversation, workspaceId, workspace.path, config.initialPrompt);
    return;
  }

  // PTY path.
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

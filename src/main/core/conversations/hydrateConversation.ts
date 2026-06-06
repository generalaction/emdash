import { and, eq } from 'drizzle-orm';
import { nativeChatService } from '@main/core/native-chat/native-chat-service';
import { resolveNativeChatTarget } from '@main/core/native-chat/resolve-native-chat-target';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { parseConversationConfig } from '@shared/conversation-config';
import { resolveTask } from '../projects/utils';
import { mapConversationRowToConversation } from './utils';

export async function hydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const task = resolveTask(projectId, taskId);
  if (!task) throw new Error('Task not found');

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

  const isFirstSpawn = row.sessionId === null;

  if (isFirstSpawn) {
    // Write session_id before spawning — idempotency guard against double-hydrate.
    await db
      .update(conversations)
      .set({ sessionId: conversationId })
      .where(eq(conversations.id, conversationId));
  }

  const config = parseConversationConfig(row.config);
  const isResuming = !isFirstSpawn;

  if (config.uiMode === 'native-chat') {
    // Native chat has no PTY to hydrate. The only work on first hydrate is
    // delivering a deferred initial prompt (task-creation flow); transcripts
    // are pulled by the renderer through the nativeChat RPC.
    if (isFirstSpawn && config.initialPrompt?.trim()) {
      const target = resolveNativeChatTarget(taskId);
      await nativeChatService.startTurn({
        conversation: mapConversationRowToConversation(row),
        cwd: target.cwd,
        taskEnvVars: target.taskEnvVars,
        prompt: config.initialPrompt,
      });
    }
    return;
  }

  await task.conversations.startSession(
    mapConversationRowToConversation(row, isResuming),
    undefined,
    isResuming,
    isFirstSpawn ? config.initialPrompt : undefined
  );
}

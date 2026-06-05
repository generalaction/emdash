import { and, eq } from 'drizzle-orm';
import { resolveTask } from '@main/core/projects/utils';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { parseConversationConfig, serializeConversationConfig } from '@shared/conversation-config';
import { isNativeChatProvider } from '@shared/conversation-ui';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { resolveNativeChatTarget } from './resolve-native-chat-target';

/**
 * Flip a terminal-mode Codex conversation to the native chat surface: stop the
 * PTY session, persist the mode, and let the renderer re-route. If the TUI
 * session id was captured via hooks, native turns resume the same Codex
 * session; the terminal transcript itself is not imported.
 */
export async function switchCodexChatToNative(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [row] = await db
    .select({ provider: conversations.provider, config: conversations.config })
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
  if (!row.provider || !isNativeChatProvider(row.provider)) {
    throw new Error(`Native chat is not supported for provider: ${row.provider ?? 'unknown'}`);
  }

  // Throws for remote or unprovisioned tasks — same constraints as sending.
  resolveNativeChatTarget(taskId);

  const task = resolveTask(projectId, taskId);
  if (task) {
    await task.conversations.stopSession(conversationId);
  }

  const config = parseConversationConfig(row.config);
  if (config.uiMode !== 'native-chat') {
    config.uiMode = 'native-chat';
    await db
      .update(conversations)
      .set({ config: serializeConversationConfig(config) })
      .where(eq(conversations.id, conversationId));
  }

  events.emit(conversationChangedChannel, {
    conversationId,
    taskId,
    projectId,
    changes: { uiMode: 'native-chat' },
  });
}

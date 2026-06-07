import { and, eq } from 'drizzle-orm';
import { hydrateConversation } from '@main/core/conversations/hydrateConversation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import type { ConversationConfig } from '@shared/core/conversations/conversation-config';
import { conversationChangedChannel } from '@shared/core/conversations/conversationEvents';
import { nativeChatService } from './native-chat-service';

/**
 * Fallback path: flip a native-chat conversation back to the CLI terminal and
 * spawn its PTY session. The provider session id captured during native turns
 * is reused, so the terminal resumes the same provider session.
 */
export async function switchNativeChatToTerminalMode(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [row] = await db
    .select({ config: conversations.config })
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

  await nativeChatService.dispose(conversationId);

  const [freshRow] = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);
  if (!freshRow) throw new Error('Conversation not found');

  const config: ConversationConfig = { ...(freshRow.config ?? {}) };
  if (config.uiMode) {
    delete config.uiMode;
    await db
      .update(conversations)
      .set({ config })
      .where(eq(conversations.id, conversationId));
    events.emit(conversationChangedChannel, {
      conversationId,
      taskId,
      projectId,
      changes: { uiMode: 'terminal' },
    });
  }

  await hydrateConversation(projectId, taskId, conversationId);
}

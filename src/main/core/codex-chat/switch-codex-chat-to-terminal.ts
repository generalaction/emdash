import { and, eq } from 'drizzle-orm';
import { hydrateConversation } from '@main/core/conversations/hydrateConversation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { parseConversationConfig, serializeConversationConfig } from '@shared/conversation-config';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { codexChatService } from './codex-chat-service';

/**
 * Fallback path: flip a native-chat conversation back to the CLI terminal and
 * spawn its PTY session. The Codex thread id captured during native turns is
 * reused, so the terminal resumes the same Codex session.
 */
export async function switchCodexChatToTerminal(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  codexChatService.dispose(conversationId);

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

  const config = parseConversationConfig(row.config);
  if (config.uiMode) {
    delete config.uiMode;
    await db
      .update(conversations)
      .set({ config: serializeConversationConfig(config) })
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

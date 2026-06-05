import { and, eq } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { isNativeChatProvider } from '@shared/conversation-ui';
import type { NativeChatAttachment } from '@shared/native-chat';
import { validateAttachments } from './attachments';
import { codexChatService } from './codex-chat-service';
import { resolveNativeChatTarget } from './resolve-native-chat-target';

export async function sendCodexChatMessage(
  projectId: string,
  taskId: string,
  conversationId: string,
  text: string,
  attachments?: NativeChatAttachment[]
): Promise<void> {
  const validatedAttachments = validateAttachments(attachments);
  if (!text.trim() && validatedAttachments.length === 0) return;

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
  if (!isNativeChatProvider(conversation.providerId) || conversation.uiMode !== 'native-chat') {
    throw new Error('Conversation is not in native chat mode');
  }

  const target = resolveNativeChatTarget(taskId);
  await codexChatService.startTurn({
    conversation,
    cwd: target.cwd,
    taskEnvVars: target.taskEnvVars,
    prompt: text,
    attachments: validatedAttachments,
  });
}

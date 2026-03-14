import { count } from 'node:console';
import { and, eq } from 'drizzle-orm';
import { ProviderId } from '@shared/agent-provider-registry';
import { Conversation } from '@shared/conversations';
import { db } from '@main/db/client';
import { ConversationRow, conversations } from '@main/db/schema';

export function mapConversationRowToConversation(
  row: ConversationRow,
  resume: boolean = false
): Conversation {
  return {
    id: row.id,
    title: row.title,
    taskId: row.taskId,
    projectId: row.projectId,
    providerId: row.provider as ProviderId,
    autoApprove: row.config ? JSON.parse(row.config).autoApprove : undefined,
    resume: resume,
  };
}

export async function getConversationTitle(taskId: string, provider: ProviderId): Promise<string> {
  const result = await db
    .select({ count: count() })
    .from(conversations)
    .where(and(eq(conversations.taskId, taskId), eq(conversations.provider, provider)));
  return `${provider} ${(result[0]?.count ?? 0) + 1}`;
}

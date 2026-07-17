import { err, ok, type BaseError, type Result } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export type SetModeIdError = BaseError<
  'empty-mode-id' | 'conversation-not-found' | 'not-acp-conversation'
>;

/**
 * Persists the last user-selected ACP session mode id into the conversation's
 * config JSON so it can be re-applied on the next session start/resume.
 *
 * Mode ids only exist for ACP conversations, so non-ACP configs are rejected.
 * Returns the conversation routing context for callers that need to emit an update.
 */
export async function setConversationModeId(
  conversationId: string,
  modeId: string,
  database = db
): Promise<Result<{ projectId: string; taskId: string }, SetModeIdError>> {
  const trimmed = modeId.trim();
  if (!trimmed) return err({ type: 'empty-mode-id' });

  const [row] = await database
    .select({
      config: conversations.config,
      projectId: conversations.projectId,
      taskId: conversations.taskId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!row) return err({ type: 'conversation-not-found', message: conversationId });
  if (row.config?.type !== 'acp') {
    return err({ type: 'not-acp-conversation', message: conversationId });
  }

  const context = { projectId: row.projectId, taskId: row.taskId };
  if (row.config.modeId === trimmed) return ok(context);

  await database
    .update(conversations)
    .set({ config: { ...row.config, modeId: trimmed }, updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, conversationId));

  return ok(context);
}

import { err, ok, type BaseError, type Result } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export type SetSessionIdError = BaseError<'empty-session-id' | 'conversation-not-found'>;

/**
 * Writes the agent-facing session id directly to the conversations.session_id column.
 *
 * Performs a single guarded UPDATE rather than a read-then-write: the affected-row
 * count tells us whether the conversation existed, so no existence pre-check is needed.
 * Returns an error when the id is empty or the conversation does not exist.
 */
export async function setSessionId(
  conversationId: string,
  sessionId: string
): Promise<Result<void, SetSessionIdError>> {
  const trimmed = sessionId.trim();
  if (!trimmed) return err({ type: 'empty-session-id' });

  const rows = await db
    .update(conversations)
    .set({ sessionId: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, conversationId))
    .returning({ id: conversations.id });

  if (rows.length === 0) {
    return err({ type: 'conversation-not-found', message: conversationId });
  }

  return ok();
}

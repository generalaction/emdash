import { err, ok, type BaseError, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export type SetSessionIdError = BaseError<'empty-session-id' | 'conversation-not-found'>;
type SessionIdDb = Pick<typeof db, 'select' | 'update'>;

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

export async function setSessionIdIfUnset(
  conversationId: string,
  sessionId: string,
  database: SessionIdDb = db
): Promise<Result<{ updated: boolean; sessionId: string }, SetSessionIdError>> {
  const trimmed = sessionId.trim();
  if (!trimmed) return err({ type: 'empty-session-id' });

  const rows = await database
    .update(conversations)
    .set({ sessionId: trimmed, updatedAt: new Date().toISOString() })
    .where(and(eq(conversations.id, conversationId), isNull(conversations.sessionId)))
    .returning({ sessionId: conversations.sessionId });

  if (rows[0]?.sessionId) return ok({ updated: true, sessionId: rows[0].sessionId });

  const [existing] = await database
    .select({ sessionId: conversations.sessionId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!existing) {
    return err({ type: 'conversation-not-found', message: conversationId });
  }

  return ok({ updated: false, sessionId: existing.sessionId ?? trimmed });
}

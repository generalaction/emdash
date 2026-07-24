import { err, ok, type BaseError, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';

export type SetSessionIdError = BaseError<'empty-session-id' | 'conversation-not-found'>;
type SessionIdDb = Pick<AppDb, 'select' | 'update'>;

/**
 * Writes the agent-facing session id directly to the conversations.session_id column.
 *
 * Performs a single guarded UPDATE rather than a read-then-write: the affected-row
 * count tells us whether the conversation existed, so no existence pre-check is needed.
 * Returns the conversation routing context for callers that need to emit an update.
 */
export async function setSessionId(
  conversationId: string,
  sessionId: string,
  database: SessionIdDb
): Promise<Result<{ projectId: string; taskId: string }, SetSessionIdError>> {
  const trimmed = sessionId.trim();
  if (!trimmed) return err({ type: 'empty-session-id' });

  const [context] = await database
    .update(conversations)
    .set({ sessionId: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, conversationId))
    .returning({ projectId: conversations.projectId, taskId: conversations.taskId });

  if (!context) {
    return err({ type: 'conversation-not-found', message: conversationId });
  }

  return ok(context);
}

export async function setSessionIdIfUnset(
  conversationId: string,
  sessionId: string,
  database: SessionIdDb
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

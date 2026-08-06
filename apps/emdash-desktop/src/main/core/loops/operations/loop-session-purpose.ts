import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { loops } from '@main/db/schema';
import type { LoopSessionPurpose } from '@shared/core/loops/loop-state';

export async function getPersistedLoopSessionPurpose(
  taskId: string,
  conversationId: string
): Promise<LoopSessionPurpose | null> {
  const rows = await db.select({ state: loops.state }).from(loops).where(eq(loops.taskId, taskId));
  for (const row of rows) {
    const attempt = row.state?.sessionAttempts.find(
      (candidate) => candidate.conversationId === conversationId
    );
    if (attempt) return attempt.purpose;
  }
  return null;
}

export function requiresExplicitLoopTarget(purpose: LoopSessionPurpose | null): boolean {
  return purpose === 'e2e' || purpose === 'browser-verification';
}

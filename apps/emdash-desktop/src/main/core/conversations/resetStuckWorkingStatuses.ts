import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

/**
 * At startup no agent is actually running yet — PTY sessions and ACP pools are
 * spawned lazily when a conversation is opened. Any conversation persisted as
 * 'working' is therefore stale: a crash, force-quit, or (for ACP) a turn whose
 * 'stop'/'error' event never landed before the app closed. Reset those rows to
 * 'idle' so their tab and sidebar indicators don't show a perpetual spinner.
 *
 * Runs once during boot, before the renderer loads its conversation list, so the
 * cleaned-up status is what the renderer reads — no IPC notification required.
 *
 * @returns the number of conversations reset.
 */
export async function resetStuckWorkingStatuses(): Promise<number> {
  const result = await db
    .update(conversations)
    .set({ agentStatus: 'idle', agentStatusSeen: 1 })
    .where(eq(conversations.agentStatus, 'working'));
  return result.changes ?? 0;
}

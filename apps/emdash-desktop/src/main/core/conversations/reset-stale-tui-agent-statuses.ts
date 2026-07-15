import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';

export async function resetStaleTuiAgentStatuses(): Promise<void> {
  try {
    await db
      .update(conversations)
      .set({ agentStatus: 'idle', agentStatusSeen: 1 })
      .where(
        and(
          eq(conversations.type, 'pty'),
          inArray(conversations.agentStatus, ['working', 'awaiting-input'])
        )
      );
  } catch (error) {
    log.warn('Failed to reset stale TUI agent statuses', { error: String(error) });
  }
}

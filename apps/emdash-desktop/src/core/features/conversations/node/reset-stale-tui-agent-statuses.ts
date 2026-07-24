import { log } from '@emdash/shared/logger';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';

export async function resetStaleTuiAgentStatuses(db: AppDb): Promise<void> {
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

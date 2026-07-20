import { and, eq, inArray } from 'drizzle-orm';
import { conversations } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { log } from '@main/lib/logger';

export async function resetStaleAcpAgentStatuses(): Promise<void> {
  try {
    await getAppDb()
      .update(conversations)
      .set({ agentStatus: 'idle', agentStatusSeen: 1 })
      .where(
        and(
          eq(conversations.type, 'acp'),
          inArray(conversations.agentStatus, ['working', 'awaiting-input'])
        )
      );
  } catch (error) {
    log.warn('Failed to reset stale ACP agent statuses', { error: String(error) });
  }
}

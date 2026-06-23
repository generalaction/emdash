import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { app } from 'electron';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';

class AppBadgeService {
  private unreadCount = 0;

  async initialize(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<void> {
    try {
      const [row] = await db
        .select({ value: count() })
        .from(conversations)
        .innerJoin(tasks, eq(tasks.id, conversations.taskId))
        .where(
          and(
            eq(conversations.agentStatusSeen, 0),
            inArray(conversations.agentStatus, ['awaiting-input', 'error', 'completed']),
            isNull(tasks.archivedAt)
          )
        );

      this.setCount(row?.value ?? 0, { force: true });
    } catch (error) {
      log.warn('app-badge: failed to sync unread count', { error: String(error) });
    }
  }

  clear(): void {
    this.setCount(0, { force: true });
  }

  setVisibleNotificationCount(count: number): void {
    this.setCount(Math.max(0, Math.floor(count)), { force: true });
  }

  private setCount(count: number, options: { force?: boolean } = {}): void {
    if (!options.force && count === this.unreadCount) return;

    this.unreadCount = count;
    const succeeded = app.setBadgeCount(count);
    if (!succeeded && count > 0) {
      log.debug('app-badge: platform did not accept badge count', { count });
    }
  }
}

export const appBadgeService = new AppBadgeService();

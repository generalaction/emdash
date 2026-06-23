import { app } from 'electron';
import { log } from '@main/lib/logger';

class AppBadgeService {
  private unreadCount = 0;

  initialize(): void {
    this.clear();
  }

  clear(): void {
    this.setCount(0);
  }

  setVisibleNotificationCount(count: number): void {
    this.setCount(Math.max(0, Math.floor(count)));
  }

  private setCount(count: number): void {
    if (count === this.unreadCount) return;

    this.unreadCount = count;
    const succeeded = app.setBadgeCount(count);
    if (!succeeded && count > 0) {
      log.debug('app-badge: platform did not accept badge count', { count });
    }
  }
}

export const appBadgeService = new AppBadgeService();

import { createLiveModelReplica } from '@emdash/wire';
import { OptimisticLiveModel } from '@emdash/wire/util/mobx';
import type { DesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { notificationsContract, type AppNotification } from '../api';

export class NotificationsFeedStore {
  private readonly model: OptimisticLiveModel<typeof notificationsContract.feed>;

  constructor(client: DesktopWireClient) {
    const replica = createLiveModelReplica(notificationsContract.feed, client.notifications.feed);
    this.model = new OptimisticLiveModel(notificationsContract.feed, undefined, replica);
  }

  get ready(): Promise<void> {
    return this.model.ready;
  }

  get all(): AppNotification[] {
    return Object.values(this.model.values.list ?? {}).sort((a, b) => b.createdAt - a.createdAt);
  }

  get unreadCount(): number {
    return this.all.reduce(
      (sum, notification) => (notification.readAt === null ? sum + notification.count : sum),
      0
    );
  }

  read(ids: string[]): void {
    if (ids.length === 0) return;
    void this.model.mutations.markRead({ ids, at: Date.now() });
  }

  markAllRead(): void {
    void this.model.mutations.markAllRead({ at: Date.now() });
  }

  dismiss(id: string): void {
    void this.model.mutations.dismiss({ ids: [id] });
  }

  async dispose(): Promise<void> {
    await this.model.dispose();
  }
}

let storePromise: Promise<NotificationsFeedStore> | null = null;

export function getNotificationsFeedStore(): Promise<NotificationsFeedStore> {
  storePromise ??= getDesktopWireClient().then((client) => {
    const store = new NotificationsFeedStore(client);
    return store.ready.then(() => store);
  });
  return storePromise;
}

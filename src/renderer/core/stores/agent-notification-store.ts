import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  agentEventChannel,
  isAttentionNotification,
  type AgentEvent,
  type NotificationType,
  type SoundEvent,
} from '@shared/events/agentEvents';
import { soundPlayer } from '../../lib/soundPlayer';
import { events } from '../ipc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentNotification = {
  ptyId: string;
  providerId: string;
  type: NotificationType;
  message?: string;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// AgentNotificationStore — global singleton
// ---------------------------------------------------------------------------

class AgentNotificationStore {
  /** Per-task pending notifications (permission prompts, idle prompts, etc.) */
  notificationsByTaskId = observable.map<string, AgentNotification[]>();

  constructor() {
    makeObservable(this, {
      notificationsByTaskId: observable,
      hasAnyPendingNotifications: computed,
      dismissNotifications: action,
    });

    events.on(agentEventChannel, ({ event, appFocused }) => {
      const sound = _mapToSound(event);
      if (sound) soundPlayer.play(sound, appFocused);

      runInAction(() => {
        this._handleEvent(event);
      });
    });
  }

  get hasAnyPendingNotifications(): boolean {
    return this.notificationsByTaskId.size > 0;
  }

  /** Dismiss all notifications for a task — call when user navigates to it. */
  dismissNotifications(taskId: string): void {
    this.notificationsByTaskId.delete(taskId);
  }

  private _handleEvent(event: AgentEvent): void {
    if (event.type === 'notification') {
      const nt = event.payload.notificationType;
      if (isAttentionNotification(nt)) {
        const ptyId = event.ptyId ?? event.conversationId;
        const existing = this.notificationsByTaskId.get(event.taskId) ?? [];
        // Replace any existing notification from the same PTY to avoid duplicates.
        const filtered = existing.filter((n) => n.ptyId !== ptyId);
        this.notificationsByTaskId.set(event.taskId, [
          ...filtered,
          {
            ptyId,
            providerId: event.providerId ?? '',
            type: nt,
            message: event.payload.message,
            timestamp: event.timestamp,
          },
        ]);
      }
    } else if (event.type === 'stop') {
      const stopPtyId = event.ptyId ?? event.conversationId;
      const existing = this.notificationsByTaskId.get(event.taskId);
      if (!existing) return;
      const filtered = existing.filter((n) => n.ptyId !== stopPtyId);
      if (filtered.length === 0) {
        this.notificationsByTaskId.delete(event.taskId);
      } else {
        this.notificationsByTaskId.set(event.taskId, filtered);
      }
    }
  }
}

function _mapToSound(event: AgentEvent): SoundEvent | null {
  if (event.type === 'stop') return 'task_complete';
  if (event.type === 'notification') {
    const nt = event.payload.notificationType;
    if (isAttentionNotification(nt)) {
      return 'needs_attention';
    }
  }
  return null;
}

/** Global singleton — initialises itself on first import. */
export const agentNotificationStore = new AgentNotificationStore();

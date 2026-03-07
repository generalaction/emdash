import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AgentEvent, NotificationType, SoundEvent } from '@shared/events/agentEvents';
import { agentEventChannel } from '@shared/events/agentEvents';
import { soundPlayer } from '../lib/soundPlayer';
import { events } from '../lib/rpc';

export type AgentNotification = {
  ptyId: string;
  providerId: string;
  type: NotificationType;
  message?: string;
  timestamp: number;
};

type AgentContextValue = {
  /** Per-task pending notifications (permission prompts, idle prompts, etc.) */
  notificationsByTaskId: Record<string, AgentNotification[]>;
  /** Dismiss all notifications for a task — call when user navigates to it */
  dismissNotifications: (taskId: string) => void;
  /** True if any task currently has a pending attention-needing notification */
  hasAnyPendingNotifications: boolean;
};

const AgentContext = createContext<AgentContextValue | null>(null);

function mapToSound(event: AgentEvent): SoundEvent | null {
  if (event.type === 'stop') return 'task_complete';
  if (event.type === 'notification') {
    const nt = event.payload.notificationType;
    if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
      return 'needs_attention';
    }
  }
  return null;
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [notificationsByTaskId, setNotificationsByTaskId] = useState<
    Record<string, AgentNotification[]>
  >({});

  useEffect(() => {
    return events.on(agentEventChannel, ({ event, appFocused }) => {
      // Play sounds
      const sound = mapToSound(event);
      if (sound) soundPlayer.play(sound, appFocused);

      if (event.type === 'notification') {
        const nt = event.payload.notificationType;
        if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
          setNotificationsByTaskId((prev) => {
            const existing = prev[event.taskId] ?? [];
            // Replace any existing notification from the same PTY so we don't accumulate duplicates
            const filtered = existing.filter((n) => n.ptyId !== event.ptyId);
            return {
              ...prev,
              [event.taskId]: [
                ...filtered,
                {
                  ptyId: event.ptyId,
                  providerId: event.providerId,
                  type: nt,
                  message: event.payload.message,
                  timestamp: event.timestamp,
                },
              ],
            };
          });
        }
      } else if (event.type === 'stop') {
        // Agent finished — clear its notifications
        setNotificationsByTaskId((prev) => {
          const existing = prev[event.taskId];
          if (!existing) return prev;
          const filtered = existing.filter((n) => n.ptyId !== event.ptyId);
          if (filtered.length === existing.length) return prev;
          const next = { ...prev };
          if (filtered.length === 0) delete next[event.taskId];
          else next[event.taskId] = filtered;
          return next;
        });
      }
    });
  }, []);

  const dismissNotifications = useCallback((taskId: string) => {
    setNotificationsByTaskId((prev) => {
      if (!prev[taskId]) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }, []);

  const hasAnyPendingNotifications = Object.keys(notificationsByTaskId).length > 0;

  return (
    <AgentContext.Provider
      value={{ notificationsByTaskId, dismissNotifications, hasAnyPendingNotifications }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used within AgentProvider');
  return ctx;
}

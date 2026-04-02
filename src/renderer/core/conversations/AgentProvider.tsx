/**
 * AgentProvider has been replaced by the global `agentNotificationStore`
 * singleton. This file is kept as a thin compatibility shim so that any
 * future consumers can import `useAgent()` without requiring a context wrap.
 *
 * Sound playback and event subscription are handled by the singleton on import.
 */
import { agentNotificationStore } from '../stores/agent-notification-store';

export type { AgentNotification } from '../stores/agent-notification-store';

export function useAgent() {
  return {
    notificationsByTaskId: Object.fromEntries(agentNotificationStore.notificationsByTaskId),
    dismissNotifications: (taskId: string) => agentNotificationStore.dismissNotifications(taskId),
    hasAnyPendingNotifications: agentNotificationStore.hasAnyPendingNotifications,
  };
}

import { defineEvent } from '@shared/ipc/events';

export type AgentEventType = 'notification' | 'stop' | 'error';

export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog';

export const ATTENTION_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  'permission_prompt',
  'idle_prompt',
  'elicitation_dialog',
]);

export function isAttentionNotification(nt: NotificationType | undefined): nt is NotificationType {
  return nt != null && ATTENTION_NOTIFICATION_TYPES.has(nt);
}

export interface AgentEvent {
  type: AgentEventType;
  source?: 'hook' | 'classifier';
  ptyId?: string;
  providerId?: string;
  projectId: string;
  taskId: string;
  conversationId: string;
  timestamp: number;
  payload: {
    notificationType?: NotificationType;
    title?: string;
    message?: string;
    lastAssistantMessage?: string;
  };
}

export interface AgentEventEnvelope {
  event: AgentEvent;
  appFocused: boolean;
}

export type SoundEvent = 'needs_attention' | 'task_complete';

export const agentEventChannel = defineEvent<AgentEventEnvelope>('agent:event');

export interface AgentSessionExited {
  /** PTY session ID (= conversationId for agent sessions). */
  projectId: string;
  sessionId: string;
  conversationId: string;
  taskId: string;
  exitCode: number | undefined;
}

/** Emitted when an agent PTY session exits. Topic = taskId. */
export const agentSessionExitedChannel = defineEvent<AgentSessionExited>('agent:session-exited');

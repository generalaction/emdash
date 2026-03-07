import { defineEvent } from '@shared/ipc/events';

export type AgentEventType = 'notification' | 'stop' | 'error';

export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog';

export interface AgentEvent {
  type: AgentEventType;
  ptyId: string;
  /** The conversation that triggered this event. */
  conversationId: string;
  /** The task that owns this conversation. */
  taskId: string;
  providerId: string;
  timestamp: number;
  payload: {
    notificationType?: NotificationType;
    title?: string;
    message?: string;
    lastAssistantMessage?: string;
  };
}

export type AgentEventMessage = {
  event: AgentEvent;
  appFocused: boolean;
};

export type SoundEvent = 'needs_attention' | 'task_complete';

export const agentEventChannel = defineEvent<AgentEventMessage>('agent:event');

export interface AgentSessionExited {
  /** PTY session ID (= conversationId for agent sessions). */
  sessionId: string;
  conversationId: string;
  taskId: string;
  exitCode: number | undefined;
}

/** Emitted when an agent PTY session exits. Topic = taskId. */
export const agentSessionExitedChannel = defineEvent<AgentSessionExited>('agent:session-exited');

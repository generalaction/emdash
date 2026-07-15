import type {
  TuiAgentStateStatus,
  TuiNotificationType,
} from '@emdash/core/runtimes/tui-agents/api';

export type AgentEventType = 'notification' | 'stop' | 'error' | 'start';

/** Desktop-wide agent status; structurally identical to the runtime's TuiAgentStateStatus. */
export type AgentStatus = TuiAgentStateStatus;

/** Desktop-wide notification type; structurally identical to the runtime's TuiNotificationType. */
export type NotificationType = TuiNotificationType;

export interface AgentEvent {
  type: AgentEventType;
  source?: 'hook' | 'input';
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

export type SoundEvent = 'needs_attention' | 'task_complete';

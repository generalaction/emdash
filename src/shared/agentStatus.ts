export type AgentStatusKind = 'unknown' | 'working' | 'waiting' | 'complete' | 'error' | 'idle';

export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog';

export interface AgentStatusSnapshot {
  id: string;
  ptyId: string;
  providerId: string;
  kind: AgentStatusKind;
  updatedAt: number;
  message?: string;
  notificationType?: NotificationType; // ← Preserved for UI differentiation
}

export interface TaskStatusSnapshot {
  taskId: string;
  kind: AgentStatusKind;
  updatedAt: number;
}

export type AgentStatusKind = 'unknown' | 'working' | 'waiting' | 'complete' | 'error' | 'idle';

export interface AgentStatusSnapshot {
  id: string;
  ptyId: string;
  providerId: string;
  kind: AgentStatusKind;
  updatedAt: number;
  message?: string;
}

export interface TaskStatusSnapshot {
  taskId: string;
  kind: AgentStatusKind;
  updatedAt: number;
}

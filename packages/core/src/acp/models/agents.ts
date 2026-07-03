import type { ToolStatus } from './transcript';

export type SubagentState = {
  agentId: string;
  toolCallId: string;
  turnId: string | null;
  name: string;
  status: ToolStatus;
  startedAt: number;
  completedAt?: number;
  background?: boolean;
  outputFile?: string;
  summary?: string;
};

import type { AgentStatusKind } from '@shared/agentStatus';

const EMPTY_STATUS = 'unknown' as const;

export function deriveTaskStatus(statuses: AgentStatusKind[]): AgentStatusKind {
  if (statuses.includes('waiting')) return 'waiting';
  if (statuses.includes('working')) return 'working';
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('complete')) return 'complete';
  if (statuses.includes('idle')) return 'idle';
  return EMPTY_STATUS;
}

import { type Agent } from '../types';
import type { Task } from '../types/app';

export const getAgentForTask = (task: Task): Agent | null => {
  if ((task.metadata as any)?.multiAgent?.enabled) {
    return null;
  }
  return (task.agentId as Agent) || 'codex';
};

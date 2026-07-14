import type { AgentStatus } from '@shared/core/agents/agentEvents';

export function isAutomationTaskRunning(status: AgentStatus | null) {
  return status === 'working' || status === 'awaiting-input';
}

export function isAutomationConversationRunning(conversation: {
  status: AgentStatus;
  seen: boolean;
}) {
  return isAutomationTaskRunning(conversation.status);
}

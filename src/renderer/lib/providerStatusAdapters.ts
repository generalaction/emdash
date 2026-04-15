import type { AgentEvent } from '@shared/agentEvents';
import type { AgentStatusKind } from '@shared/agentStatus';

export function mapAgentEventToStatus(event: AgentEvent): AgentStatusKind | null {
  if (
    event.providerId !== 'claude' &&
    event.providerId !== 'codex' &&
    event.providerId !== 'opencode'
  ) {
    return null;
  }

  if (event.type === 'stop') return 'complete';
  if (event.type === 'error') return 'error';
  if (event.type !== 'notification') return null;

  const notificationType = event.payload.notificationType;
  if (
    notificationType === 'permission_prompt' ||
    notificationType === 'elicitation_dialog' ||
    notificationType === 'idle_prompt' ||
    notificationType === 'auth_success'
  ) {
    return 'waiting';
  }

  return null;
}

export function mapUserInputToStatus(providerId: string): AgentStatusKind | null {
  if (providerId === 'claude' || providerId === 'codex' || providerId === 'opencode') {
    return 'working';
  }
  return null;
}

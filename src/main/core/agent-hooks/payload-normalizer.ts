import type { AgentEvent } from '@shared/events/agentEvents';

export function normalizePayload(
  providerId: string,
  eventType: string,
  body: Record<string, unknown>
): AgentEvent['payload'] {
  const payload: AgentEvent['payload'] = {
    notificationType: (body.notification_type ??
      body.notificationType) as AgentEvent['payload']['notificationType'],
    lastAssistantMessage: (body.last_assistant_message ?? body.lastAssistantMessage) as
      | string
      | undefined,
    title: body.title as string | undefined,
    message: body.message as string | undefined,
  };

  if (!payload.notificationType && providerId === 'codex' && body.type === 'agent-turn-complete') {
    payload.notificationType = 'idle_prompt';
  }

  // Claude Code's Notification hook payload has no notification_type field.
  if (!payload.notificationType && providerId === 'claude' && eventType === 'notification') {
    payload.notificationType = isClaudePermissionPrompt(payload.message)
      ? 'permission_prompt'
      : 'idle_prompt';
  }

  return payload;
}

function isClaudePermissionPrompt(message: string | undefined): boolean {
  if (!message) return false;
  return [/\ballow\s+.+\?/i, /\bgrant\s+.+\baccess\b/i, /\bneeds?\s+your\s+permission\b/i].some(
    (pattern) => pattern.test(message)
  );
}

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

  // Claude Code's Notification hook payload has no notification_type field —
  // distinguish permission prompts from idle prompts by inspecting the message.
  if (!payload.notificationType && providerId === 'claude' && eventType === 'notification') {
    payload.notificationType = /\bpermission\b/i.test(payload.message ?? '')
      ? 'permission_prompt'
      : 'idle_prompt';
  }

  return payload;
}

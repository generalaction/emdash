import type { Conversation } from '@shared/conversations';
import type { AgentEvent } from '@shared/events/agentEvents';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';
import type { ChatProviderAdapter, ChatProviderBackend, ChatProviderRuntimeEvent } from '../types';

export class CodexChatAdapter implements ChatProviderAdapter {
  readonly providerId = 'codex' as const;

  buildMessageInput(conversation: Conversation, text: string): string {
    return `${buildPromptInjectionPayload({ providerId: conversation.providerId, text })}\r`;
  }

  async cancel(conversation: Conversation, backend: ChatProviderBackend): Promise<void> {
    await backend.interruptSession(conversation.id);
  }

  async respondToPermission(
    conversation: Conversation,
    backend: ChatProviderBackend,
    request: Parameters<NonNullable<ChatProviderAdapter['respondToPermission']>>[2],
    response: Parameters<NonNullable<ChatProviderAdapter['respondToPermission']>>[3]
  ): Promise<void> {
    const option = request.options.find((candidate) => candidate.id === response.optionId);
    if (!option) throw new Error('Permission option not found');
    await backend.sendInput(conversation.id, buildPermissionResponseInput(option));
  }

  mapAgentEvent(event: AgentEvent): ChatProviderRuntimeEvent[] {
    const events: ChatProviderRuntimeEvent[] = [];

    if (event.payload.toolName) {
      events.push({
        type: 'timeline',
        item: {
          id: event.payload.toolCallId ?? `codex-tool-${event.timestamp}`,
          kind: 'tool_call',
          payload: {
            toolName: event.payload.toolName,
            status: event.payload.toolStatus ?? 'running',
            input: event.payload.toolInput,
            output: event.payload.toolOutput,
            error: event.payload.toolError,
          },
        },
      });
    }

    const assistantText =
      event.source === 'classifier' ? undefined : event.payload.lastAssistantMessage?.trim();
    if (assistantText) {
      events.push({
        type: 'timeline',
        item: {
          kind: 'assistant_message',
          payload: { text: assistantText },
        },
      });
    }

    if (event.type === 'start') {
      events.push({ type: 'status', status: 'working' });
    } else if (event.type === 'stop') {
      events.push({ type: 'status', status: 'completed' });
    } else if (event.type === 'error') {
      events.push({
        type: 'timeline',
        item: {
          kind: 'error',
          payload: { message: event.payload.message ?? 'Agent reported an error' },
        },
      });
      events.push({ type: 'status', status: 'error' });
    } else if (event.type === 'notification') {
      if (event.payload.notificationType === 'idle_prompt') {
        events.push({ type: 'status', status: 'completed' });
      } else if (
        event.payload.notificationType === 'permission_prompt' ||
        event.payload.notificationType === 'elicitation_dialog'
      ) {
        events.push({
          type: 'timeline',
          item: {
            id: event.payload.requestId ?? `codex-permission-${event.timestamp}`,
            kind: 'permission_request',
            payload: {
              requestId: event.payload.requestId ?? `codex-permission-${event.timestamp}`,
              title:
                event.payload.title ??
                (event.payload.notificationType === 'permission_prompt'
                  ? 'Codex permission request'
                  : 'Codex needs input'),
              body:
                event.payload.message ??
                (event.payload.notificationType === 'permission_prompt'
                  ? 'Codex is asking for permission to continue.'
                  : 'Codex is asking for additional input.'),
              options:
                event.payload.notificationType === 'permission_prompt'
                  ? [
                      { id: 'approve', label: 'Approve', kind: 'primary' },
                      { id: 'deny', label: 'Deny', kind: 'danger' },
                    ]
                  : [{ id: 'continue', label: 'Continue', kind: 'primary' }],
              status: 'pending',
            },
          },
        });
        events.push({ type: 'status', status: 'awaiting-input' });
      }
    }

    return events;
  }
}

export const codexChatAdapter = new CodexChatAdapter();

function buildPermissionResponseInput(
  option: Parameters<NonNullable<ChatProviderAdapter['respondToPermission']>>[2]['options'][number]
): string {
  const normalizedId = option.id.toLowerCase();
  const normalizedLabel = option.label.toLowerCase();
  if (
    option.kind === 'danger' ||
    normalizedId === 'deny' ||
    normalizedId === 'reject' ||
    normalizedLabel === 'deny' ||
    normalizedLabel === 'reject'
  ) {
    return 'n\r';
  }
  if (
    option.kind === 'primary' ||
    normalizedId === 'approve' ||
    normalizedId === 'allow' ||
    normalizedId === 'continue' ||
    normalizedLabel === 'approve' ||
    normalizedLabel === 'allow'
  ) {
    return 'y\r';
  }
  return `${option.label}\r`;
}

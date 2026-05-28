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

  mapAgentEvent(event: AgentEvent): ChatProviderRuntimeEvent[] {
    const events: ChatProviderRuntimeEvent[] = [];

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
            kind: 'error',
            payload: {
              message:
                'Codex requested interactive input that is not supported in chat UI yet. Cancel this turn or use terminal UI for this conversation.',
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

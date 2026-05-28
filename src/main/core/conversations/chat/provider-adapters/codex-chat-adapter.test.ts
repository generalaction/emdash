import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { AgentEvent } from '@shared/events/agentEvents';
import { CodexChatAdapter } from './codex-chat-adapter';

function makeConversation(): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    lastInteractedAt: null,
    isInitialConversation: false,
    runtimeMode: 'chat',
  };
}

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    type: 'notification',
    providerId: 'codex',
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'conversation-1',
    timestamp: 1,
    payload: {},
    ...overrides,
  };
}

describe('CodexChatAdapter', () => {
  it('builds bracketed-paste message input for Codex', () => {
    const adapter = new CodexChatAdapter();

    const input = adapter.buildMessageInput(makeConversation(), 'hello\nworld');

    expect(input).toBe('\x1b[200~hello\nworld\x1b[201~\r');
  });

  it('builds plain carriage-return input for single-line Codex messages', () => {
    const adapter = new CodexChatAdapter();

    const input = adapter.buildMessageInput(makeConversation(), 'hello');

    expect(input).toBe('hello\r');
  });

  it('interrupts the provider backend on cancel', async () => {
    const adapter = new CodexChatAdapter();
    const interruptSession = vi.fn().mockResolvedValue(undefined);

    await adapter.cancel(makeConversation(), {
      interruptSession,
      sendInput: vi.fn(),
    });

    expect(interruptSession).toHaveBeenCalledWith('conversation-1');
  });

  it('maps assistant payloads and status events', () => {
    const adapter = new CodexChatAdapter();

    expect(
      adapter.mapAgentEvent(
        makeEvent({
          payload: { lastAssistantMessage: ' done ', notificationType: 'idle_prompt' },
        })
      )
    ).toEqual([
      {
        type: 'timeline',
        item: { kind: 'assistant_message', payload: { text: 'done' } },
      },
      { type: 'status', status: 'completed' },
    ]);

    expect(
      adapter.mapAgentEvent(
        makeEvent({
          payload: { notificationType: 'permission_prompt' },
        })
      )
    ).toEqual([
      {
        type: 'timeline',
        item: {
          kind: 'error',
          payload: {
            message:
              'Codex requested interactive input that is not supported in chat UI yet. Cancel this turn or use terminal UI for this conversation.',
          },
        },
      },
      { type: 'status', status: 'awaiting-input' },
    ]);
  });

  it('maps errors to timeline and status events', () => {
    const adapter = new CodexChatAdapter();

    expect(
      adapter.mapAgentEvent(
        makeEvent({
          type: 'error',
          payload: { message: 'failed' },
        })
      )
    ).toEqual([
      { type: 'timeline', item: { kind: 'error', payload: { message: 'failed' } } },
      { type: 'status', status: 'error' },
    ]);
  });

  it('does not treat classifier status labels as assistant messages', () => {
    const adapter = new CodexChatAdapter();

    expect(
      adapter.mapAgentEvent(
        makeEvent({
          type: 'error',
          source: 'classifier',
          payload: { message: 'failed', lastAssistantMessage: 'failed' },
        })
      )
    ).toEqual([
      { type: 'timeline', item: { kind: 'error', payload: { message: 'failed' } } },
      { type: 'status', status: 'error' },
    ]);
  });
});

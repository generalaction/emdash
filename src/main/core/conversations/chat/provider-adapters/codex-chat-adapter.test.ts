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

  it('sends Codex permission responses through the provider backend', async () => {
    const adapter = new CodexChatAdapter();
    const sendInput = vi.fn().mockResolvedValue(undefined);
    const conversation = makeConversation();
    const request = {
      id: 'permission-item-1',
      conversationId: conversation.id,
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      kind: 'permission_request' as const,
      requestId: 'permission-1',
      title: 'Run command?',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' as const },
        { id: 'deny', label: 'Deny', kind: 'danger' as const },
      ],
      status: 'pending' as const,
    };

    await adapter.respondToPermission?.(
      conversation,
      {
        interruptSession: vi.fn(),
        sendInput,
      },
      request,
      { requestId: 'permission-1', optionId: 'approve' }
    );
    await adapter.respondToPermission?.(
      conversation,
      {
        interruptSession: vi.fn(),
        sendInput,
      },
      request,
      { requestId: 'permission-1', optionId: 'deny' }
    );

    expect(sendInput).toHaveBeenNthCalledWith(1, 'conversation-1', 'y\r');
    expect(sendInput).toHaveBeenNthCalledWith(2, 'conversation-1', 'n\r');
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
          timestamp: 42,
          payload: {
            notificationType: 'permission_prompt',
            requestId: 'permission-1',
            title: 'Run shell command?',
            message: 'Codex wants to run `pnpm test`.',
          },
        })
      )
    ).toEqual([
      {
        type: 'timeline',
        item: {
          id: 'permission-1',
          kind: 'permission_request',
          payload: {
            requestId: 'permission-1',
            title: 'Run shell command?',
            body: 'Codex wants to run `pnpm test`.',
            options: [
              { id: 'approve', label: 'Approve', kind: 'primary' },
              { id: 'deny', label: 'Deny', kind: 'danger' },
            ],
            status: 'pending',
          },
        },
      },
      { type: 'status', status: 'awaiting-input' },
    ]);
  });

  it('maps structured tool call payloads to stable timeline updates', () => {
    const adapter = new CodexChatAdapter();

    expect(
      adapter.mapAgentEvent(
        makeEvent({
          timestamp: 42,
          payload: {
            toolCallId: 'tool-1',
            toolName: 'shell',
            toolStatus: 'completed',
            toolInput: { command: 'pnpm test' },
            toolOutput: 'passed',
          },
        })
      )
    ).toEqual([
      {
        type: 'timeline',
        item: {
          id: 'tool-1',
          kind: 'tool_call',
          payload: {
            toolName: 'shell',
            status: 'completed',
            input: { command: 'pnpm test' },
            output: 'passed',
            error: undefined,
          },
        },
      },
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

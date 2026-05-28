import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { ChatConversationRuntime } from './chat-conversation-runtime';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  appendUserMessage: vi.fn(),
  getLatestAssistantMessage: vi.fn(),
  requireChatConversation: vi.fn(),
  emit: vi.fn(),
  eventEmit: vi.fn(),
  resolveTask: vi.fn(),
  sendInput: vi.fn(),
  interruptSession: vi.fn(),
}));

vi.mock('@main/core/conversations/conversation-events', () => ({
  conversationEvents: {
    _emit: mocks.eventEmit,
  },
}));

vi.mock('../../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
  },
}));

vi.mock('./chat-timeline-store', () => ({
  chatTimelineStore: {
    append: mocks.append,
    appendUserMessage: mocks.appendUserMessage,
    getLatestAssistantMessage: mocks.getLatestAssistantMessage,
    requireChatConversation: mocks.requireChatConversation,
  },
}));

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

describe('ChatConversationRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const conversation = makeConversation();
    mocks.getLatestAssistantMessage.mockResolvedValue(undefined);
    mocks.requireChatConversation.mockResolvedValue(conversation);
    mocks.appendUserMessage.mockResolvedValue({
      id: 'message-1',
      conversationId: conversation.id,
      kind: 'user_message',
      sequence: 1,
      text: 'hello',
      createdAt: '2026-05-28T00:00:00.000Z',
    });
    mocks.append.mockResolvedValue({
      id: 'message-2',
      conversationId: conversation.id,
      kind: 'assistant_message',
      sequence: 2,
      text: 'done',
      createdAt: '2026-05-28T00:00:00.000Z',
    });
    mocks.sendInput.mockResolvedValue(undefined);
    mocks.interruptSession.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({
      conversations: {
        sendInput: mocks.sendInput,
        interruptSession: mocks.interruptSession,
      },
    });
  });

  it('writes sent chat messages to the backing provider and emits input metadata', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });

    expect(mocks.sendInput).toHaveBeenCalledTimes(1);
    expect(mocks.sendInput.mock.calls[0]?.[0]).toBe('conversation-1');
    expect(mocks.sendInput.mock.calls[0]?.[1]).toContain('hello');
    expect(mocks.sendInput.mock.calls[0]?.[1]).toMatch(/\r$/);
    expect(mocks.appendUserMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendInput.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.eventEmit).toHaveBeenCalledWith('conversation:input-submitted', {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      providerId: 'codex',
    });
  });

  it('rejects sends without a backend provider before persisting the message', async () => {
    mocks.resolveTask.mockReturnValue(undefined);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('Task not found');

    expect(mocks.appendUserMessage).not.toHaveBeenCalled();
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
  });

  it('records an error item when backend write fails after persistence', async () => {
    mocks.sendInput.mockRejectedValue(new Error('write failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('write failed');

    expect(mocks.appendUserMessage).toHaveBeenCalledTimes(1);
    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Failed to send message to the agent backend' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
  });

  it('records initial prompts and emits input metadata after backend startup', async () => {
    const runtime = new ChatConversationRuntime();
    const conversation = makeConversation();

    await runtime.startConversation(conversation, 'hello');

    expect(mocks.appendUserMessage).toHaveBeenCalledWith(conversation, 'hello');
    expect(mocks.eventEmit).toHaveBeenCalledWith('conversation:input-submitted', {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      providerId: 'codex',
    });
  });

  it('does not write to the backend when user message persistence fails', async () => {
    mocks.appendUserMessage.mockRejectedValue(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('db failed');

    expect(mocks.sendInput).not.toHaveBeenCalled();
  });

  it('interrupts the backing provider when cancelling a turn', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');

    expect(mocks.interruptSession).toHaveBeenCalledWith('conversation-1');
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'idle',
      })
    );
  });

  it('returns an explicit unsupported error for permission responses', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('Permission responses are not supported by the chat runtime yet');
  });

  it('records assistant and error agent events into the timeline', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'done',
      },
    });
    await runtime.recordAgentEvent({
      type: 'error',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        message: 'failed',
      },
    });

    expect(mocks.append).toHaveBeenNthCalledWith(1, makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'done' },
    });
    expect(mocks.append).toHaveBeenNthCalledWith(2, makeConversation(), {
      kind: 'error',
      payload: { message: 'failed' },
    });
  });

  it('deduplicates repeated assistant messages from hook events', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const event = {
      type: 'notification' as const,
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'done',
      },
    };
    await runtime.recordAgentEvent(event);
    await runtime.recordAgentEvent(event);

    expect(mocks.append).toHaveBeenCalledTimes(1);
  });

  it('allows the same assistant text again after a new user turn', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const event = {
      type: 'notification' as const,
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'done',
      },
    };
    await runtime.recordAgentEvent(event);
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'again' });
    await runtime.recordAgentEvent(event);

    expect(mocks.append).toHaveBeenCalledTimes(2);
  });

  it('deduplicates assistant messages already present before hydration', async () => {
    mocks.getLatestAssistantMessage.mockResolvedValue('done');
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'done',
      },
    });

    expect(mocks.append).not.toHaveBeenCalled();
  });
});

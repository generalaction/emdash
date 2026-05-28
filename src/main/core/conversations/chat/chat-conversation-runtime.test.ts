import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSessionEvents } from '@main/core/conversations/agent-session-events';
import type { Conversation } from '@shared/conversations';
import { ChatConversationRuntime } from './chat-conversation-runtime';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  appendUserMessage: vi.fn(),
  deleteItem: vi.fn(),
  recoverPendingUserMessages: vi.fn(),
  emitItem: vi.fn(),
  getLatestAssistantMessage: vi.fn(),
  markUserMessageDeliveryStarted: vi.fn(),
  markUserMessageDelivered: vi.fn(),
  requireChatConversation: vi.fn(),
  emit: vi.fn(),
  eventEmit: vi.fn(),
  resolveTask: vi.fn(),
  sendInput: vi.fn(),
  interruptSession: vi.fn(),
  waitUntilReadyForInput: vi.fn(),
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
    deleteItem: mocks.deleteItem,
    emitItem: mocks.emitItem,
    getLatestAssistantMessage: mocks.getLatestAssistantMessage,
    markUserMessageDeliveryStarted: mocks.markUserMessageDeliveryStarted,
    markUserMessageDelivered: mocks.markUserMessageDelivered,
    recoverPendingUserMessages: mocks.recoverPendingUserMessages,
    requireChatConversation: mocks.requireChatConversation,
  },
}));

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
    mocks.waitUntilReadyForInput.mockResolvedValue(undefined);
    mocks.deleteItem.mockResolvedValue(undefined);
    mocks.markUserMessageDeliveryStarted.mockResolvedValue(undefined);
    mocks.markUserMessageDelivered.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({
      conversations: {
        sendInput: mocks.sendInput,
        interruptSession: mocks.interruptSession,
        waitUntilReadyForInput: mocks.waitUntilReadyForInput,
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
    expect(mocks.markUserMessageDeliveryStarted.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendInput.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.markUserMessageDelivered.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.sendInput.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.markUserMessageDelivered.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.emitItem.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.eventEmit.mock.invocationCallOrder[0]).toBeGreaterThan(
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

  it('records an error item when backend write fails after persisting the user message silently', async () => {
    mocks.sendInput.mockRejectedValue(new Error('write failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('write failed');

    expect(mocks.appendUserMessage).toHaveBeenCalledWith(
      makeConversation(),
      { text: 'hello' },
      { emit: false }
    );
    expect(mocks.deleteItem).toHaveBeenCalledWith(makeConversation(), 'message-1');
    expect(mocks.emitItem).not.toHaveBeenCalled();
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

  it('checks input readiness again after backend delivery fails', async () => {
    mocks.sendInput.mockRejectedValueOnce(new Error('write failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('write failed');
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'again' });

    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledTimes(2);
    expect(mocks.sendInput).toHaveBeenCalledTimes(2);
  });

  it('does not write to the backend when marking delivery start fails', async () => {
    mocks.markUserMessageDeliveryStarted.mockRejectedValueOnce(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('db failed');

    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.deleteItem).toHaveBeenCalledWith(makeConversation(), 'message-1');
    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Failed to send message to the agent backend' },
    });
    mocks.append.mockClear();

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'orphan response',
      },
    });

    expect(mocks.append).not.toHaveBeenCalled();
  });

  it('does not treat cancellation during delivery-start marking as a safely unsent turn', async () => {
    const deliveryStarted = deferred();
    mocks.markUserMessageDeliveryStarted.mockReturnValueOnce(deliveryStarted.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.markUserMessageDeliveryStarted).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    deliveryStarted.resolve();

    await expect(sendPromise).rejects.toThrow('Message send was cancelled');
    expect(mocks.interruptSession).toHaveBeenCalledWith('conversation-1');
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.deleteItem).toHaveBeenCalledWith(makeConversation(), 'message-1');
  });

  it('checks input readiness again after successfully cancelling an active turn', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'again' });

    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledTimes(2);
    expect(mocks.sendInput).toHaveBeenCalledTimes(2);
  });

  it('does not write input after a backend exit races delivery-start marking', async () => {
    const deliveryStarted = deferred();
    mocks.markUserMessageDeliveryStarted.mockReturnValueOnce(deliveryStarted.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.markUserMessageDeliveryStarted).toHaveBeenCalled());

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });
    deliveryStarted.resolve();

    await expect(sendPromise).rejects.toThrow('Agent backend exited before message could be sent');
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.deleteItem).toHaveBeenCalledWith(makeConversation(), 'message-1');
    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Agent backend exited before message could be sent' },
    });
  });

  it('still records backend send errors when timeline error recording succeeds', async () => {
    mocks.sendInput.mockRejectedValue(new Error('write failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('write failed');

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

    expect(mocks.appendUserMessage).toHaveBeenCalledWith(
      conversation,
      { text: 'hello' },
      { emit: false }
    );
    expect(mocks.sendInput).toHaveBeenCalledWith(
      'conversation-1',
      expect.stringContaining('hello')
    );
    expect(mocks.eventEmit).toHaveBeenCalledWith('conversation:input-submitted', {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      providerId: 'codex',
    });
  });

  it('waits for backend input readiness before the first chat send', async () => {
    const ready = deferred();
    mocks.waitUntilReadyForInput.mockReturnValueOnce(ready.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.waitUntilReadyForInput).toHaveBeenCalled());

    expect(mocks.appendUserMessage).not.toHaveBeenCalled();
    expect(mocks.sendInput).not.toHaveBeenCalled();

    ready.resolve();
    await sendPromise;

    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledWith(makeConversation());
    expect(mocks.appendUserMessage.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.waitUntilReadyForInput.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.sendInput).toHaveBeenCalledWith(
      'conversation-1',
      expect.stringContaining('hello')
    );
  });

  it('cancels cleanly while backend input readiness is still pending', async () => {
    const ready = deferred();
    mocks.waitUntilReadyForInput.mockReturnValueOnce(ready.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.waitUntilReadyForInput).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });
    ready.resolve();

    await expect(sendPromise).rejects.toThrow('Message send was cancelled');
    expect(mocks.appendUserMessage).not.toHaveBeenCalled();
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'idle',
      })
    );

    mocks.waitUntilReadyForInput.mockClear();
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'next' });
    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledTimes(1);
  });

  it('does not persist a user message when backend input readiness fails', async () => {
    mocks.waitUntilReadyForInput.mockRejectedValueOnce(new Error('not ready'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('not ready');

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

  it('waits for backend readiness again after the backend exits', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'first' });
    await runtime.recordAgentEvent({
      type: 'notification',
      source: 'classifier',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'idle_prompt',
      },
    });
    mocks.waitUntilReadyForInput.mockClear();

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 0,
    });
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'second' });

    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledTimes(1);
    expect(mocks.sendInput).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.stringContaining('second')
    );
  });

  it('blocks sends while the initial prompt is awaiting a provider response', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.startConversation(makeConversation(), 'hello');

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'next' })
    ).rejects.toThrow('Agent is still responding');
    expect(mocks.sendInput).toHaveBeenCalledTimes(1);
  });

  it('suppresses orphan provider output when user message persistence fails', async () => {
    mocks.appendUserMessage.mockRejectedValue(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('db failed');

    expect(mocks.sendInput).not.toHaveBeenCalled();
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'orphan response',
      },
    });

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'later orphan response',
      },
    });

    expect(mocks.append).not.toHaveBeenCalled();
  });

  it('restores provider event handling after a failed message persistence retry succeeds', async () => {
    mocks.appendUserMessage.mockRejectedValueOnce(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('db failed');
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'orphan response',
      },
    });
    expect(mocks.append).not.toHaveBeenCalled();

    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'retry' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'retry response',
      },
    });

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'retry response' },
    });
  });

  it('does not attach provider events that arrive before backend delivery starts to the new turn', async () => {
    let resolveAppendUserMessage:
      | ((value: Awaited<ReturnType<typeof mocks.appendUserMessage>>) => void)
      | undefined;
    mocks.appendUserMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveAppendUserMessage = resolve;
      })
    );
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.appendUserMessage).toHaveBeenCalled());

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
    resolveAppendUserMessage?.({
      id: 'message-1',
      conversationId: 'conversation-1',
      kind: 'user_message',
      sequence: 1,
      text: 'hello',
      createdAt: '2026-05-28T00:00:00.000Z',
    });
    await sendPromise;

    expect(mocks.append).not.toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'done' },
    });
  });

  it('does not emit the user item or buffered events before backend delivery resolves', async () => {
    const send = deferred();
    mocks.sendInput.mockReturnValue(send.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'first',
      },
    });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'second',
      },
    });

    expect(mocks.eventEmit).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();

    send.resolve();
    await sendPromise;

    expect(mocks.append).toHaveBeenNthCalledWith(1, makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'first' },
    });
    expect(mocks.append).toHaveBeenNthCalledWith(2, makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'second' },
    });
    expect(mocks.appendUserMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.append.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('rejects a second message while waiting for the provider response', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'first' });

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'second' })
    ).rejects.toThrow('Agent is still responding');
    expect(mocks.sendInput).toHaveBeenCalledTimes(1);
  });

  it('does not emit a message that is cancelled while backend delivery is pending', async () => {
    const send = deferred();
    mocks.sendInput.mockReturnValue(send.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'next' })
    ).rejects.toThrow('A message is already being sent');
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'idle',
      })
    );
    send.resolve();

    await expect(sendPromise).rejects.toThrow('Message send was cancelled');
    expect(mocks.appendUserMessage).toHaveBeenCalledWith(
      makeConversation(),
      { text: 'hello' },
      { emit: false }
    );
    expect(mocks.deleteItem).toHaveBeenCalledWith(makeConversation(), 'message-1');
    expect(mocks.markUserMessageDelivered).not.toHaveBeenCalled();
    expect(mocks.emitItem).not.toHaveBeenCalled();
    expect(mocks.eventEmit).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'idle',
      })
    );
  });

  it('does not reveal a cancelled delivery while backend cancellation is pending', async () => {
    const send = deferred();
    const cancel = deferred();
    mocks.sendInput.mockReturnValue(send.promise);
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());

    const cancelPromise = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
    send.resolve();

    await Promise.resolve();
    expect(mocks.markUserMessageDelivered).not.toHaveBeenCalled();
    expect(mocks.emitItem).not.toHaveBeenCalled();
    expect(mocks.eventEmit).not.toHaveBeenCalled();

    cancel.resolve();
    await cancelPromise;
    await expect(sendPromise).rejects.toThrow('Message send was cancelled');
    expect(mocks.markUserMessageDelivered).not.toHaveBeenCalled();
    expect(mocks.emitItem).not.toHaveBeenCalled();
    expect(mocks.eventEmit).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Failed to send message to the agent backend' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'idle',
      })
    );
  });

  it('keeps the delivered message when backend cancellation fails after delivery resolves', async () => {
    const send = deferred();
    const cancel = deferred();
    mocks.sendInput.mockReturnValue(send.promise);
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());

    const cancelPromise = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
    send.resolve();

    await Promise.resolve();
    expect(mocks.emitItem).not.toHaveBeenCalled();

    cancel.reject(new Error('interrupt failed'));
    await expect(cancelPromise).rejects.toThrow('interrupt failed');
    await sendPromise;

    expect(mocks.deleteItem).not.toHaveBeenCalledWith(makeConversation(), 'message-1');
    expect(mocks.emitItem).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
  });

  it('buffers provider output for the next pending turn after cancellation', async () => {
    const send = deferred();
    mocks.sendInput.mockReturnValue(send.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    mocks.append.mockClear();
    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'stale answer',
      },
    });

    send.resolve();
    await sendPromise;

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'stale answer' },
    });
  });

  it('records content-bearing hook events after a stale classifier completion', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });

    await runtime.recordAgentEvent({
      type: 'notification',
      source: 'classifier',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'idle_prompt',
      },
    });
    mocks.append.mockClear();

    await runtime.recordAgentEvent({
      type: 'notification',
      source: 'hook',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'final answer',
        notificationType: 'idle_prompt',
      },
    });

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'final answer' },
    });
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

  it('restores provider event handling when backend cancellation fails', async () => {
    mocks.interruptSession.mockRejectedValueOnce(new Error('interrupt failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(runtime.cancelTurn('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'interrupt failed'
    );
    mocks.append.mockClear();

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'still running',
      },
    });

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'still running' },
    });
  });

  it('keeps provider events that arrive while a failed backend cancellation is in flight', async () => {
    const cancel = deferred();
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });

    const cancelPromise = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'still running',
      },
    });

    expect(mocks.append).not.toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'still running' },
    });

    cancel.reject(new Error('interrupt failed'));
    await expect(cancelPromise).rejects.toThrow('interrupt failed');

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'still running' },
    });
  });

  it('restores pending turn cancellation state when backend cancellation fails', async () => {
    const send = deferred();
    mocks.sendInput.mockReturnValue(send.promise);
    mocks.interruptSession.mockRejectedValueOnce(new Error('interrupt failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());

    await expect(runtime.cancelTurn('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'interrupt failed'
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'working',
      })
    );
    send.resolve();
    await sendPromise;

    expect(mocks.deleteItem).not.toHaveBeenCalledWith(makeConversation(), 'message-1');
    expect(mocks.emitItem).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
  });

  it('keeps awaiting-input blocked when backend cancellation fails', async () => {
    mocks.interruptSession.mockRejectedValueOnce(new Error('interrupt failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'permission_prompt',
      },
    });

    await expect(runtime.cancelTurn('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'interrupt failed'
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'awaiting-input',
      })
    );
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'after failure' })
    ).rejects.toThrow('Agent is awaiting input');
  });

  it('continues the turn when revealing the delivered user message fails', async () => {
    mocks.emitItem.mockRejectedValueOnce(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).resolves.toMatchObject({
      item: { id: 'message-1' },
    });

    expect(mocks.sendInput).toHaveBeenCalledWith(
      'conversation-1',
      expect.stringContaining('hello')
    );
    expect(mocks.eventEmit).toHaveBeenCalledWith(
      'conversation:input-submitted',
      expect.objectContaining({ conversationId: 'conversation-1' })
    );
    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Message was sent, but Emdash could not update the chat timeline.' },
    });
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'again' })
    ).rejects.toThrow('Agent is still responding');
  });

  it('reveals the sent message when marking it delivered fails', async () => {
    mocks.markUserMessageDelivered.mockRejectedValueOnce(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).resolves.toMatchObject({
      item: { id: 'message-1' },
    });

    expect(mocks.sendInput).toHaveBeenCalledWith(
      'conversation-1',
      expect.stringContaining('hello')
    );
    expect(mocks.emitItem).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
    expect(mocks.deleteItem).not.toHaveBeenCalledWith(makeConversation(), 'message-1');
  });

  it('interrupts cancellation even when recording the cancellation marker fails', async () => {
    mocks.append.mockRejectedValueOnce(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    mocks.append.mockClear();
    mocks.emit.mockClear();
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'idle_prompt',
      },
    });

    expect(mocks.interruptSession).toHaveBeenCalledWith('conversation-1');
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'completed',
      })
    );
  });

  it('ignores late provider events after a turn is cancelled', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    mocks.append.mockClear();
    mocks.emit.mockClear();

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'idle_prompt',
        lastAssistantMessage: 'late answer',
      },
    });

    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'completed',
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

  it('emits provider adapter status events from agent hooks', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    mocks.emit.mockClear();

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'idle_prompt',
      },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'completed',
      })
    );

    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'again' });
    mocks.emit.mockClear();

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'permission_prompt',
      },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'awaiting-input',
      })
    );
    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: {
        message:
          'Codex requested interactive input that is not supported in chat UI yet. Cancel this turn or use terminal UI for this conversation.',
      },
    });
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'while blocked' })
    ).rejects.toThrow('Agent is awaiting input');
    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    mocks.waitUntilReadyForInput.mockClear();
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'after cancel' });
    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledTimes(1);
    expect(mocks.sendInput).toHaveBeenLastCalledWith(
      'conversation-1',
      expect.stringContaining('after cancel')
    );
  });

  it('ignores completion and attention statuses when no response is active', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'idle_prompt',
      },
    });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'permission_prompt',
      },
    });

    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'completed',
      })
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'awaiting-input',
      })
    );
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it('still emits mapped status events when timeline append fails', async () => {
    mocks.append.mockRejectedValueOnce(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    mocks.emit.mockClear();

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'done',
        notificationType: 'idle_prompt',
      },
    });

    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'completed',
      })
    );
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
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'idle_prompt',
      },
    });
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

  it('marks active chat conversations failed when the backend exits while responding', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    mocks.emit.mockClear();

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Agent backend exited before completing the turn' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'again' });
    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledTimes(2);
    expect(mocks.sendInput).toHaveBeenCalledTimes(2);
  });

  it('marks awaiting-input chat conversations failed when the backend exits', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'permission_prompt',
      },
    });
    mocks.emit.mockClear();

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Agent backend exited before completing the turn' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'again' });
    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledTimes(2);
    expect(mocks.sendInput).toHaveBeenCalledTimes(2);
  });

  it('keeps delivered user messages when the backend exits while delivery is resolving', async () => {
    const send = deferred();
    mocks.sendInput.mockReturnValue(send.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });
    send.resolve();
    await sendPromise;

    expect(mocks.deleteItem).not.toHaveBeenCalledWith(makeConversation(), 'message-1');
    expect(mocks.emitItem).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Agent backend exited before completing the turn' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
  });

  it('does not lose backend exits that arrive while pending events are flushing', async () => {
    mocks.append.mockImplementation(async () => {
      await runtime.recordBackendExit({
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        sessionId: 'conversation-1',
        exitCode: 1,
      });
      return {
        id: 'assistant-1',
        conversationId: 'conversation-1',
        kind: 'assistant_message',
        sequence: 2,
        text: 'answer',
        createdAt: '2026-05-28T00:00:00.000Z',
      };
    });
    const send = deferred();
    mocks.sendInput.mockReturnValue(send.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'answer',
      },
    });
    send.resolve();
    await sendPromise;

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Agent backend exited before completing the turn' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'error' })
    );
  });

  it('ignores backend exits when no chat turn is active', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });

    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('treats backend exit during cancellation as idle cancellation', async () => {
    const cancel = deferred();
    mocks.interruptSession.mockReturnValue(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });

    const cancelPromise = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });
    cancel.resolve();
    await cancelPromise;

    expect(mocks.append).not.toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Agent backend exited before completing the turn' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'idle' })
    );
  });

  it('processes backend exits that arrive while a failed cancellation is in flight', async () => {
    const cancel = deferred();
    mocks.interruptSession.mockReturnValue(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });

    const cancelPromise = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });
    cancel.reject(new Error('interrupt failed'));

    await expect(cancelPromise).rejects.toThrow('interrupt failed');

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Agent backend exited before completing the turn' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'error' })
    );
  });

  it('keeps provider output after a cancelled turn crosses into the next send', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'next' });
    mocks.append.mockClear();

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'stale cancelled answer',
      },
    });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'current answer',
      },
    });

    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(mocks.append).toHaveBeenNthCalledWith(1, makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'stale cancelled answer' },
    });
    expect(mocks.append).toHaveBeenNthCalledWith(2, makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'current answer' },
    });
  });

  it('handles backend exit through the agent session event hook', async () => {
    const runtime = new ChatConversationRuntime({ subscribeToSessionEvents: true });
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    mocks.emit.mockClear();

    agentSessionEvents._emit('agent:session-exited', {
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });

    await vi.waitFor(() =>
      expect(mocks.emit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'conversation:status' }),
        expect.objectContaining({ conversationId: 'conversation-1', status: 'error' })
      )
    );
  });
});

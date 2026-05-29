import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSessionEvents } from '@main/core/conversations/agent-session-events';
import type { Conversation } from '@shared/conversations';
import { ChatConversationRuntime } from './chat-conversation-runtime';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  appendUserMessage: vi.fn(),
  deleteItem: vi.fn(),
  recoverPendingUserMessages: vi.fn(),
  cancelPendingPermissionRequests: vi.fn(),
  emitItem: vi.fn(),
  getLatestAssistantMessage: vi.fn(),
  markUserMessageDeliveryStarted: vi.fn(),
  markUserMessageDelivered: vi.fn(),
  markUserMessageCancelled: vi.fn(),
  getPendingPermissionRequest: vi.fn(),
  reopenCancelledPermissionRequest: vi.fn(),
  restoreCancelledPermissionRequests: vi.fn(),
  restorePendingPermissionRequest: vi.fn(),
  resolvePermissionRequest: vi.fn(),
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
    cancelPendingPermissionRequests: mocks.cancelPendingPermissionRequests,
    deleteItem: mocks.deleteItem,
    emitItem: mocks.emitItem,
    getLatestAssistantMessage: mocks.getLatestAssistantMessage,
    getPendingPermissionRequest: mocks.getPendingPermissionRequest,
    markUserMessageCancelled: mocks.markUserMessageCancelled,
    markUserMessageDeliveryStarted: mocks.markUserMessageDeliveryStarted,
    markUserMessageDelivered: mocks.markUserMessageDelivered,
    recoverPendingUserMessages: mocks.recoverPendingUserMessages,
    reopenCancelledPermissionRequest: mocks.reopenCancelledPermissionRequest,
    restoreCancelledPermissionRequests: mocks.restoreCancelledPermissionRequests,
    restorePendingPermissionRequest: mocks.restorePendingPermissionRequest,
    resolvePermissionRequest: mocks.resolvePermissionRequest,
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
    mocks.cancelPendingPermissionRequests.mockResolvedValue([]);
    mocks.deleteItem.mockResolvedValue(undefined);
    mocks.markUserMessageDeliveryStarted.mockResolvedValue(undefined);
    mocks.markUserMessageDelivered.mockResolvedValue(undefined);
    mocks.markUserMessageCancelled.mockResolvedValue(undefined);
    mocks.getPendingPermissionRequest.mockResolvedValue({
      id: 'permission-item-1',
      conversationId: conversation.id,
      kind: 'permission_request',
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      requestId: 'permission-1',
      title: 'Run command?',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'danger' },
      ],
      status: 'pending',
    });
    mocks.reopenCancelledPermissionRequest.mockResolvedValue({
      id: 'permission-item-1',
      conversationId: conversation.id,
      kind: 'permission_request',
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      requestId: 'permission-1',
      title: 'Run command?',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'danger' },
      ],
      status: 'pending',
    });
    mocks.restoreCancelledPermissionRequests.mockResolvedValue([]);
    mocks.restorePendingPermissionRequest.mockResolvedValue({
      id: 'permission-item-1',
      conversationId: conversation.id,
      kind: 'permission_request',
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      requestId: 'permission-1',
      title: 'Run command?',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'danger' },
      ],
      status: 'pending',
    });
    mocks.resolvePermissionRequest.mockResolvedValue({
      id: 'permission-item-1',
      conversationId: conversation.id,
      kind: 'permission_request',
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      requestId: 'permission-1',
      title: 'Run command?',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'danger' },
      ],
      status: 'approved',
    });
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

  it('cancels stale pending permission requests during hydration', async () => {
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());

    expect(mocks.recoverPendingUserMessages).toHaveBeenCalledWith(makeConversation());
    expect(mocks.cancelPendingPermissionRequests).toHaveBeenCalledWith(makeConversation());
  });

  it('restores permissions cancelled during hydration when activation fails', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    mocks.getLatestAssistantMessage.mockRejectedValueOnce(new Error('latest failed'));
    const runtime = new ChatConversationRuntime();

    await expect(runtime.hydrateConversation(makeConversation())).rejects.toThrow('latest failed');

    expect(mocks.restoreCancelledPermissionRequests).toHaveBeenCalledWith(makeConversation(), [
      'permission-1',
    ]);
    expect(runtime.isActive('conversation-1')).toBe(false);
  });

  it('does not cancel live pending permissions on repeated hydration', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
    mocks.cancelPendingPermissionRequests.mockClear();
    mocks.recoverPendingUserMessages.mockClear();

    await runtime.hydrateConversation(makeConversation());

    expect(mocks.recoverPendingUserMessages).not.toHaveBeenCalled();
    expect(mocks.cancelPendingPermissionRequests).not.toHaveBeenCalled();
  });

  it('does not restore hydration permissions after a user send supersedes recovery', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'continue' });
    await runtime.dehydrateConversation('conversation-1');

    expect(mocks.restoreCancelledPermissionRequests).not.toHaveBeenCalled();
  });

  it('accepts requestless replayed permission prompts after hydration so cancelled rows can reopen', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'codex-permission-1000',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'codex-permission-1000',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    mocks.append.mockResolvedValueOnce({
      id: 'codex-permission-12345',
      conversationId: 'conversation-1',
      kind: 'permission_request',
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      requestId: 'codex-permission-12345',
      title: 'Codex permission request',
      body: 'Codex is asking for permission to continue.',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'danger' },
      ],
      status: 'pending',
    });
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: {
        notificationType: 'permission_prompt',
      },
    });

    expect(mocks.reopenCancelledPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({
        id: 'codex-permission-12345',
        kind: 'permission_request',
        payload: expect.objectContaining({
          requestId: 'codex-permission-12345',
          status: 'pending',
        }),
      }),
      ['codex-permission-1000']
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('accepts requestless elicitation prompts after hydration', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'codex-permission-1000',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'codex-permission-1000',
        title: 'Codex needs input',
        body: 'Codex is asking for additional input.',
        options: [{ id: 'continue', label: 'Continue', kind: 'primary' }],
        status: 'cancelled',
      },
    ]);
    mocks.append.mockResolvedValueOnce({
      id: 'codex-permission-12345',
      conversationId: 'conversation-1',
      kind: 'permission_request',
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      requestId: 'codex-permission-12345',
      title: 'Codex needs input',
      body: 'Codex is asking for additional input.',
      options: [{ id: 'continue', label: 'Continue', kind: 'primary' }],
      status: 'pending',
    });
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: {
        notificationType: 'elicitation_dialog',
      },
    });

    expect(mocks.reopenCancelledPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({
        id: 'codex-permission-12345',
        kind: 'permission_request',
        payload: expect.objectContaining({
          requestId: 'codex-permission-12345',
          status: 'pending',
        }),
      }),
      ['codex-permission-1000']
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('ends hydration recovery when an idle prompt arrives before a permission replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: { notificationType: 'idle_prompt' },
    });
    await runtime.dehydrateConversation('conversation-1');
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12346,
      payload: { notificationType: 'permission_prompt' },
    });

    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.restoreCancelledPermissionRequests).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'completed' })
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('reports completed when a working hydration recovery reaches idle before permission replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'start',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: {},
    });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12346,
      payload: { notificationType: 'idle_prompt' },
    });

    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'working' })
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'completed' })
    );
  });

  it('reports completed when a working hydration recovery reaches idle with assistant text', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'start',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: {},
    });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12346,
      payload: { lastAssistantMessage: 'All done', notificationType: 'idle_prompt' },
    });

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'All done' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'completed' })
    );
  });

  it('restores hydration permissions and reports error when backend exits before replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });

    expect(mocks.restoreCancelledPermissionRequests).toHaveBeenCalledWith(makeConversation(), [
      'permission-1',
    ]);
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'error' })
    );
  });

  it('does not restore hydration permissions when backend exits cleanly before replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 0,
    });

    expect(mocks.restoreCancelledPermissionRequests).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'completed' })
    );
  });

  it('does not restore hydration permissions after cancellation supersedes recovery', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.dehydrateConversation('conversation-1');

    expect(mocks.restoreCancelledPermissionRequests).not.toHaveBeenCalled();
  });

  it('keeps hydration recovery open across working events before permission replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    mocks.append.mockResolvedValueOnce({
      id: 'permission-1',
      conversationId: 'conversation-1',
      kind: 'permission_request',
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      requestId: 'codex-permission-12346',
      title: 'Codex permission request',
      body: 'Codex is asking for permission to continue.',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'danger' },
      ],
      status: 'pending',
    });
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'start',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: {},
    });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12346,
      payload: { notificationType: 'permission_prompt' },
    });

    expect(mocks.reopenCancelledPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'codex-permission-12346', kind: 'permission_request' }),
      ['permission-1']
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('keeps hydration recovery open across assistant-only events before permission replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: { lastAssistantMessage: 'Still checking' },
    });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12346,
      payload: { notificationType: 'permission_prompt' },
    });

    expect(mocks.reopenCancelledPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'codex-permission-12346', kind: 'permission_request' }),
      ['permission-1']
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('keeps hydration recovery open across assistant text in the permission replay event', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12346,
      payload: {
        lastAssistantMessage: 'Need approval',
        notificationType: 'permission_prompt',
      },
    });

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'assistant_message',
      payload: { text: 'Need approval' },
    });
    expect(mocks.reopenCancelledPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'codex-permission-12346', kind: 'permission_request' }),
      ['permission-1']
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('ends hydration recovery after duplicate resolved permission replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    mocks.reopenCancelledPermissionRequest.mockResolvedValueOnce({
      id: 'permission-1',
      conversationId: 'conversation-1',
      kind: 'permission_request',
      sequence: 1,
      createdAt: '2026-05-29T00:00:00.000Z',
      requestId: 'permission-1',
      title: 'Codex permission request',
      body: 'Codex is asking for permission to continue.',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'danger' },
      ],
      status: 'approved',
    });
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.append.mockClear();
    mocks.reopenCancelledPermissionRequest.mockClear();
    mocks.emit.mockClear();
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12346,
      payload: { notificationType: 'permission_prompt' },
    });

    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.reopenCancelledPermissionRequest).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
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

  it('cancels safely when cancellation races delivery-start marking before backend input', async () => {
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
    expect(mocks.interruptSession).not.toHaveBeenCalled();
    expect(mocks.markUserMessageCancelled).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.deleteItem).toHaveBeenCalledWith(makeConversation(), 'message-1');
  });

  it('does not let a cancelled stale send clear a newer turn', async () => {
    const deliveryStarted = deferred();
    mocks.markUserMessageDeliveryStarted.mockReturnValueOnce(deliveryStarted.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const firstSend = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'first',
    });
    await vi.waitFor(() => expect(mocks.markUserMessageDeliveryStarted).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'second' });

    deliveryStarted.resolve();
    await expect(firstSend).rejects.toThrow('Message send was cancelled');
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'third' })
    ).rejects.toThrow('Agent is still responding');
    expect(mocks.sendInput).toHaveBeenCalledTimes(1);
    expect(mocks.sendInput).toHaveBeenCalledWith(
      'conversation-1',
      expect.stringContaining('second')
    );
  });

  it('does not let stale readiness failures clear a newer turn', async () => {
    const ready = deferred();
    mocks.waitUntilReadyForInput.mockReturnValueOnce(ready.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const firstSend = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'first',
    });
    await vi.waitFor(() => expect(mocks.waitUntilReadyForInput).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'second' });

    mocks.emit.mockClear();
    mocks.append.mockClear();
    ready.reject(new Error('ready failed'));
    await expect(firstSend).rejects.toThrow('ready failed');

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'third' })
    ).rejects.toThrow('Agent is still responding');
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
  });

  it('reports cancellation when a cancelled readiness wait rejects without a newer turn', async () => {
    const ready = deferred();
    mocks.waitUntilReadyForInput.mockReturnValueOnce(ready.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.waitUntilReadyForInput).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');

    mocks.emit.mockClear();
    ready.reject(new Error('ready failed'));
    await expect(sendPromise).rejects.toThrow('Message send was cancelled');

    expect(mocks.appendUserMessage).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
  });

  it('does not let stale message persistence failures clear a newer turn', async () => {
    const appendUserMessage = deferred<Awaited<ReturnType<typeof mocks.appendUserMessage>>>();
    mocks.appendUserMessage.mockReturnValueOnce(appendUserMessage.promise).mockResolvedValueOnce({
      id: 'message-2',
      conversationId: 'conversation-1',
      kind: 'user_message',
      sequence: 2,
      text: 'second',
      createdAt: '2026-05-28T00:00:00.000Z',
    });
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const firstSend = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'first',
    });
    await vi.waitFor(() => expect(mocks.appendUserMessage).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'second' });

    mocks.emit.mockClear();
    appendUserMessage.reject(new Error('db failed'));
    await expect(firstSend).rejects.toThrow('db failed');

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'third' })
    ).rejects.toThrow('Agent is still responding');
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
  });

  it('reports cancellation when cancelled message persistence rejects without a newer turn', async () => {
    const appendUserMessage = deferred<Awaited<ReturnType<typeof mocks.appendUserMessage>>>();
    mocks.appendUserMessage.mockReturnValueOnce(appendUserMessage.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.appendUserMessage).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');

    mocks.emit.mockClear();
    appendUserMessage.reject(new Error('db failed'));
    await expect(sendPromise).rejects.toThrow('Message send was cancelled');

    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
  });

  it('does not let stale delivery-start failures clear a newer turn', async () => {
    const deliveryStarted = deferred();
    mocks.markUserMessageDeliveryStarted.mockReturnValueOnce(deliveryStarted.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const firstSend = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'first',
    });
    await vi.waitFor(() => expect(mocks.markUserMessageDeliveryStarted).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'second' });

    mocks.emit.mockClear();
    mocks.append.mockClear();
    deliveryStarted.reject(new Error('delivery failed'));
    await expect(firstSend).rejects.toThrow('delivery failed');

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'third' })
    ).rejects.toThrow('Agent is still responding');
    expect(mocks.append).not.toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Failed to send message to the agent backend' },
    });
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
  });

  it('reports cancellation when cancelled delivery-start marking rejects without a newer turn', async () => {
    const deliveryStarted = deferred();
    mocks.markUserMessageDeliveryStarted.mockReturnValueOnce(deliveryStarted.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.markUserMessageDeliveryStarted).toHaveBeenCalled());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');

    mocks.emit.mockClear();
    mocks.append.mockClear();
    deliveryStarted.reject(new Error('delivery failed'));
    await expect(sendPromise).rejects.toThrow('Message send was cancelled');

    expect(mocks.append).not.toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Failed to send message to the agent backend' },
    });
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
      })
    );
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

  it('keeps an accepted turn awaiting response when cancellation fails', async () => {
    mocks.interruptSession.mockRejectedValueOnce(new Error('cancel failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });

    await expect(runtime.cancelTurn('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'cancel failed'
    );

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'again' })
    ).rejects.toThrow('Agent is still responding');
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'working' })
    );
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

  it('reveals a message accepted by the backend before cancellation settles', async () => {
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
    expect(mocks.deleteItem).not.toHaveBeenCalledWith(makeConversation(), 'message-1');
    expect(mocks.markUserMessageDelivered).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
    expect(mocks.emitItem).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
    expect(mocks.eventEmit).toHaveBeenCalledWith(
      'conversation:input-submitted',
      expect.objectContaining({ conversationId: 'conversation-1' })
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'idle',
      })
    );
  });

  it('reveals a message accepted by the backend after cancellation is requested', async () => {
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

    await vi.waitFor(() => expect(mocks.markUserMessageDelivered).toHaveBeenCalled());
    expect(mocks.emitItem).not.toHaveBeenCalled();
    expect(mocks.eventEmit).not.toHaveBeenCalled();

    cancel.resolve();
    await cancelPromise;
    await expect(sendPromise).rejects.toThrow('Message send was cancelled');
    expect(mocks.markUserMessageDelivered).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
    expect(mocks.emitItem).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
    expect(mocks.eventEmit).toHaveBeenCalledWith(
      'conversation:input-submitted',
      expect.objectContaining({ conversationId: 'conversation-1' })
    );
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

  it('keeps a backend write failure as an error when cancellation also fails', async () => {
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
    mocks.emit.mockClear();
    mocks.append.mockClear();

    send.reject(new Error('write failed'));
    await expect(sendPromise).rejects.toThrow('write failed');
    cancel.reject(new Error('interrupt failed'));
    await expect(cancelPromise).rejects.toThrow('interrupt failed');

    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Failed to send message to the agent backend' },
    });
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'working',
      })
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'error',
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

  it('reveals a delivered message when cancellation succeeds after delivery resolves', async () => {
    const cancel = deferred();
    mocks.markUserMessageDelivered.mockImplementationOnce(async () => {
      const cancelPromise = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
      await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
      cancel.resolve();
      await cancelPromise;
    });
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('Message send was cancelled');

    expect(mocks.emitItem).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ id: 'message-1' })
    );
    expect(mocks.eventEmit).toHaveBeenCalledWith(
      'conversation:input-submitted',
      expect.objectContaining({ conversationId: 'conversation-1' })
    );
  });

  it('rejects concurrent cancel callers when the in-flight cancellation fails', async () => {
    const cancel = deferred();
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });

    const firstCancel = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
    const secondCancel = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');

    cancel.reject(new Error('interrupt failed'));

    await expect(firstCancel).rejects.toThrow('interrupt failed');
    await expect(secondCancel).rejects.toThrow('interrupt failed');
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
        requestId: 'permission-1',
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

  it('sends permission responses through the adapter and marks the turn working', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });

    await runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });

    expect(mocks.getPendingPermissionRequest).toHaveBeenCalledWith(makeConversation(), {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    expect(mocks.sendInput).toHaveBeenCalledWith('conversation-1', 'y\r');
    expect(mocks.resolvePermissionRequest).toHaveBeenCalledWith(makeConversation(), {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    expect(mocks.resolvePermissionRequest.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendInput.mock.invocationCallOrder.at(-1) ?? 0
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'working' })
    );
  });

  it('processes fast completion events while a permission response is being sent', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.emit.mockClear();

    const responseSend = deferred();
    mocks.sendInput.mockReturnValueOnce(responseSend.promise);
    const responsePromise = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledWith('conversation-1', 'y\r'));

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'idle_prompt' },
    });

    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'completed' })
    );
    responseSend.resolve();
    await responsePromise;
  });

  it('rejects concurrent permission responses before a second backend write', async () => {
    const resolvePermission = deferred();
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockClear();
    mocks.resolvePermissionRequest.mockReturnValueOnce(resolvePermission.promise);

    const firstResponse = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.resolvePermissionRequest).toHaveBeenCalled());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'new turn' })
    ).rejects.toThrow('Agent is still responding');
    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'deny',
      })
    ).rejects.toThrow('Agent is not awaiting permission input');
    expect(mocks.sendInput).not.toHaveBeenCalled();

    resolvePermission.resolve();
    await firstResponse;
    expect(mocks.sendInput).toHaveBeenCalledTimes(1);
    expect(mocks.sendInput).toHaveBeenCalledWith('conversation-1', 'y\r');
  });

  it('cancels pending permission requests and rejects stale permission responses after cancel', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');

    expect(mocks.cancelPendingPermissionRequests).toHaveBeenCalledWith(makeConversation());
    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('Agent is not awaiting permission input');
  });

  it('rejects permission responses while cancellation is in flight', async () => {
    const cancel = deferred();
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockClear();

    const cancelPromise = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());

    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('Agent cancellation is in progress');
    expect(mocks.sendInput).not.toHaveBeenCalled();

    cancel.resolve();
    await cancelPromise;
  });

  it('marks permission responses resolved before reporting backend delivery failure', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.emit.mockClear();
    mocks.sendInput.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('write failed');

    expect(mocks.resolvePermissionRequest).toHaveBeenCalledWith(makeConversation(), {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    expect(mocks.resolvePermissionRequest.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendInput.mock.invocationCallOrder.at(-1) ?? 0
    );
    expect(mocks.restorePendingPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ requestId: 'permission-1', status: 'pending' })
    );
    expect(mocks.append).toHaveBeenCalledWith(makeConversation(), {
      kind: 'error',
      payload: { message: 'Failed to send permission response to the agent backend' },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('does not emit awaiting-input when permission restore fails after backend delivery failure', async () => {
    mocks.restorePendingPermissionRequest.mockRejectedValueOnce(new Error('restore failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.emit.mockClear();
    mocks.sendInput.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('write failed');

    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'error' })
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('does not send permission responses when timeline resolution fails', async () => {
    mocks.resolvePermissionRequest.mockRejectedValueOnce(new Error('db failed'));
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockClear();

    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('db failed');

    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.resolvePermissionRequest).toHaveBeenCalledWith(makeConversation(), {
      requestId: 'permission-1',
      optionId: 'approve',
    });
  });

  it('does not restore awaiting input when cancellation wins a permission resolution race', async () => {
    const resolvePermission = deferred();
    const cancel = deferred();
    mocks.resolvePermissionRequest.mockReturnValueOnce(resolvePermission.promise);
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.resolvePermissionRequest).toHaveBeenCalled());

    const cancellation = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());

    resolvePermission.reject(new Error('db failed'));
    await expect(response).rejects.toThrow('db failed');
    cancel.resolve();
    await cancellation;

    mocks.waitUntilReadyForInput.mockClear();
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'after cancel' });
    expect(mocks.waitUntilReadyForInput).toHaveBeenCalledTimes(1);
  });

  it('does not send permission responses when cancellation starts during the permission claim', async () => {
    const resolvePermission = deferred();
    const cancel = deferred();
    mocks.resolvePermissionRequest.mockReturnValueOnce(resolvePermission.promise);
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockClear();

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.resolvePermissionRequest).toHaveBeenCalled());

    const cancellation = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());

    resolvePermission.resolve();
    await expect(response).rejects.toThrow('Agent cancellation is in progress');
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.restorePendingPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ requestId: 'permission-1', status: 'pending' })
    );
    cancel.resolve();
    await cancellation;
  });

  it('keeps permission retryable when claim failure races failed cancellation', async () => {
    const resolvePermission = deferred();
    const cancel = deferred();
    mocks.resolvePermissionRequest.mockReturnValueOnce(resolvePermission.promise);
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockClear();

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.resolvePermissionRequest).toHaveBeenCalled());
    const cancellation = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());

    resolvePermission.reject(new Error('db failed'));
    await expect(response).rejects.toThrow('db failed');
    cancel.reject(new Error('cancel failed'));
    await expect(cancellation).rejects.toThrow('cancel failed');

    await runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    expect(mocks.sendInput).toHaveBeenCalledWith('conversation-1', 'y\r');
  });

  it('does not send permission responses when the backend exits during the permission claim', async () => {
    const resolvePermission = deferred();
    mocks.resolvePermissionRequest.mockReturnValueOnce(resolvePermission.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockClear();

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.resolvePermissionRequest).toHaveBeenCalled());

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });
    resolvePermission.resolve();

    await expect(response).rejects.toThrow(
      'Agent backend exited before permission response was sent'
    );
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.restorePendingPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ requestId: 'permission-1', status: 'pending' })
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'error' })
    );
  });

  it('does not restore awaiting input when backend exit wins during permission backend write', async () => {
    const responseSend = deferred();
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.emit.mockClear();
    mocks.sendInput.mockClear();
    mocks.sendInput.mockReturnValueOnce(responseSend.promise);

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledWith('conversation-1', 'y\r'));

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });
    responseSend.reject(new Error('write failed'));

    await expect(response).rejects.toThrow('write failed');
    expect(mocks.restorePendingPermissionRequest).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'error' })
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('restores awaiting input when permission backend write fails during failed cancellation', async () => {
    const responseSend = deferred();
    const cancel = deferred();
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.emit.mockClear();
    mocks.sendInput.mockClear();
    mocks.sendInput.mockReturnValueOnce(responseSend.promise);

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledWith('conversation-1', 'y\r'));

    const cancellation = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
    responseSend.reject(new Error('write failed'));

    await expect(response).rejects.toThrow('write failed');
    expect(mocks.restorePendingPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ requestId: 'permission-1', status: 'pending' })
    );

    cancel.reject(new Error('cancel failed'));
    await expect(cancellation).rejects.toThrow('cancel failed');
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('does not restore awaiting input when completion wins during permission backend write', async () => {
    const responseSend = deferred();
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.emit.mockClear();
    mocks.sendInput.mockClear();
    mocks.sendInput.mockReturnValueOnce(responseSend.promise);

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledWith('conversation-1', 'y\r'));

    await runtime.recordAgentEvent({
      type: 'stop',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {},
    });
    responseSend.reject(new Error('write failed'));

    await expect(response).rejects.toThrow('write failed');
    expect(mocks.restorePendingPermissionRequest).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'completed' })
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'awaiting-input' })
    );
  });

  it('does not restore awaiting input when backend exit wins a failed permission claim', async () => {
    const resolvePermission = deferred();
    mocks.resolvePermissionRequest.mockReturnValueOnce(resolvePermission.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockClear();

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.resolvePermissionRequest).toHaveBeenCalled());

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });
    resolvePermission.reject(new Error('db failed'));

    await expect(response).rejects.toThrow(
      'Agent backend exited before permission response was sent'
    );
    expect(mocks.sendInput).not.toHaveBeenCalled();
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'after exit' })
    ).resolves.toBeDefined();
  });

  it('does not send permission responses when the conversation dehydrates during the permission claim', async () => {
    const resolvePermission = deferred();
    mocks.resolvePermissionRequest.mockReturnValueOnce(resolvePermission.promise);
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockClear();

    const response = runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
    await vi.waitFor(() => expect(mocks.resolvePermissionRequest).toHaveBeenCalled());

    await runtime.dehydrateConversation('conversation-1');
    resolvePermission.resolve();

    await expect(response).rejects.toThrow('Conversation chat runtime is not active');
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.restorePendingPermissionRequest).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({ requestId: 'permission-1', status: 'pending' })
    );
  });

  it('cancels pending permission requests on backend exit', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });

    await runtime.recordBackendExit({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      sessionId: 'conversation-1',
      exitCode: 1,
    });

    expect(mocks.cancelPendingPermissionRequests).toHaveBeenCalledWith(makeConversation());
    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('Agent is not awaiting permission input');
  });

  it('cancels pending permission requests when dehydrating a task', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });

    await runtime.dehydrateTask('task-1');

    expect(mocks.cancelPendingPermissionRequests).toHaveBeenCalledWith(makeConversation());
    expect(runtime.isActive('conversation-1')).toBe(false);
  });

  it('restores hydration permissions when dehydrating before replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.dehydrateConversation('conversation-1');

    expect(mocks.restoreCancelledPermissionRequests).toHaveBeenCalledWith(makeConversation(), [
      'permission-1',
    ]);
    expect(runtime.isActive('conversation-1')).toBe(false);
  });

  it('restores hydration permissions when dehydrating a task before replay', async () => {
    mocks.cancelPendingPermissionRequests.mockResolvedValueOnce([
      {
        id: 'permission-1',
        conversationId: 'conversation-1',
        kind: 'permission_request',
        sequence: 1,
        createdAt: '2026-05-29T00:00:00.000Z',
        requestId: 'permission-1',
        title: 'Codex permission request',
        body: 'Codex is asking for permission to continue.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'cancelled',
      },
    ]);
    const runtime = new ChatConversationRuntime();

    await runtime.hydrateConversation(makeConversation());
    await runtime.dehydrateTask('task-1');

    expect(mocks.restoreCancelledPermissionRequests).toHaveBeenCalledWith(makeConversation(), [
      'permission-1',
    ]);
    expect(mocks.cancelPendingPermissionRequests).toHaveBeenCalledTimes(1);
    expect(runtime.isActive('conversation-1')).toBe(false);
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
        requestId: 'permission-1',
      },
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'awaiting-input',
      })
    );
    expect(mocks.append).toHaveBeenCalledWith(
      makeConversation(),
      {
        id: 'permission-1',
        kind: 'permission_request',
        payload: {
          requestId: 'permission-1',
          title: 'Codex permission request',
          body: 'Codex is asking for permission to continue.',
          options: [
            { id: 'approve', label: 'Approve', kind: 'primary' },
            { id: 'deny', label: 'Deny', kind: 'danger' },
          ],
          status: 'pending',
        },
      },
      { upsert: true }
    );
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

  it('does not reopen awaiting-input status for duplicate resolved permission events', async () => {
    mocks.append.mockResolvedValueOnce({
      id: 'permission-1',
      conversationId: 'conversation-1',
      kind: 'permission_request',
      sequence: 2,
      createdAt: '2026-05-28T00:00:00.000Z',
      requestId: 'permission-1',
      title: 'Codex permission request',
      body: 'Codex is asking for permission to continue.',
      options: [
        { id: 'approve', label: 'Approve', kind: 'primary' },
        { id: 'deny', label: 'Deny', kind: 'danger' },
      ],
      status: 'approved',
    });
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
        notificationType: 'permission_prompt',
        requestId: 'permission-1',
      },
    });

    expect(mocks.append).toHaveBeenCalledWith(
      makeConversation(),
      expect.objectContaining({
        id: 'permission-1',
        kind: 'permission_request',
      }),
      { upsert: true }
    );
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'awaiting-input',
      })
    );
  });

  it('ignores completion and attention statuses when no response is active', async () => {
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
        notificationType: 'idle_prompt',
      },
    });
    mocks.emit.mockClear();
    mocks.append.mockClear();

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

  it('does not emit awaiting-input when permission prompt persistence fails', async () => {
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
        notificationType: 'permission_prompt',
        requestId: 'permission-1',
      },
    });

    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        status: 'awaiting-input',
      })
    );
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'next' })
    ).rejects.toThrow('Agent is still responding');
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationMessageTimelineItem,
  ConversationPermissionRequestTimelineItem,
} from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import { ChatConversationRuntime } from './chat-conversation-runtime';
import type { ChatProviderAdapter, ChatSessionConfig } from './types';

const state = vi.hoisted(() => ({
  adapter: undefined as unknown as ChatProviderAdapter,
  config: undefined as unknown as ChatSessionConfig,
  emit: vi.fn(),
  conversationEmit: vi.fn(),
  resolveTask: vi.fn(),
  setProviderSessionId: vi.fn(),
  store: {
    append: vi.fn(),
    appendUserMessage: vi.fn(),
    cancelPendingPermissionRequests: vi.fn(),
    deleteItem: vi.fn(),
    emitItem: vi.fn(),
    getPendingPermissionRequest: vi.fn(),
    markUserMessageDelivered: vi.fn(),
    recoverPendingUserMessages: vi.fn(),
    requireChatConversation: vi.fn(),
    resolvePermissionRequest: vi.fn(),
    restorePendingPermissionRequest: vi.fn(),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: state.emit },
}));

vi.mock('../conversation-events', () => ({
  conversationEvents: { _emit: state.conversationEmit },
}));

vi.mock('../set-provider-session-id', () => ({
  setProviderSessionId: state.setProviderSessionId,
}));

vi.mock('../../projects/utils', () => ({
  resolveTask: state.resolveTask,
}));

vi.mock('./chat-timeline-store', () => ({
  chatTimelineStore: state.store,
}));

vi.mock('./provider-adapters', () => ({
  getChatProviderAdapter: () => state.adapter,
}));

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    isInitialConversation: false,
    lastInteractedAt: null,
    runtimeMode: 'chat',
    ...overrides,
  };
}

function makeUserMessage(text: string): ConversationMessageTimelineItem {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    sequence: 1,
    createdAt: '2026-05-29T00:00:00.000Z',
    kind: 'user_message',
    text,
  };
}

function makePermissionRequest(): ConversationPermissionRequestTimelineItem {
  return {
    id: 'permission-1',
    conversationId: 'conversation-1',
    sequence: 2,
    createdAt: '2026-05-29T00:00:01.000Z',
    kind: 'permission_request',
    requestId: 'permission-1',
    title: 'Run command',
    options: [{ id: 'approve', label: 'Approve' }],
    status: 'pending',
  };
}

function installAdapter(overrides: Partial<ChatProviderAdapter> = {}): ChatProviderAdapter {
  const adapter: ChatProviderAdapter = {
    providerId: 'codex',
    createSession: vi.fn(async (config) => {
      state.config = config;
      return {
        conversationId: config.conversation.id,
        providerId: 'codex' as const,
        providerSessionId: 'thread-1',
      };
    }),
    resumeSession: vi.fn(async (config) => {
      state.config = config;
      return {
        conversationId: config.conversation.id,
        providerId: 'codex' as const,
        providerSessionId: config.conversation.providerSessionId ?? 'thread-1',
      };
    }),
    sendMessage: vi.fn(async () => {
      await state.config.onEvent({ type: 'status', status: 'completed' });
    }),
    tryHandleOutOfBandCommand: vi.fn(async () => false),
    cancel: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    respondToPermission: vi.fn(async () => undefined),
    listCommands: vi.fn(async () => [{ name: 'compact' }]),
    executeSlashCommand: vi.fn(async () => undefined),
    ...overrides,
  };
  state.adapter = adapter;
  return adapter;
}

describe('ChatConversationRuntime app-server boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.config = undefined as unknown as ChatSessionConfig;
    state.resolveTask.mockReturnValue({
      taskPath: '/repo',
      taskEnvVars: { FOO: 'bar' },
      workspaceKind: 'local',
    });
    state.setProviderSessionId.mockResolvedValue(true);
    state.store.append.mockResolvedValue(undefined);
    state.store.appendUserMessage.mockImplementation(async (_conversation, input) =>
      makeUserMessage(input.text)
    );
    state.store.cancelPendingPermissionRequests.mockResolvedValue(undefined);
    state.store.deleteItem.mockResolvedValue(undefined);
    state.store.emitItem.mockResolvedValue(undefined);
    state.store.getPendingPermissionRequest.mockResolvedValue(makePermissionRequest());
    state.store.markUserMessageDelivered.mockResolvedValue(undefined);
    state.store.recoverPendingUserMessages.mockResolvedValue(undefined);
    state.store.requireChatConversation.mockResolvedValue(undefined);
    state.store.resolvePermissionRequest.mockResolvedValue(undefined);
    state.store.restorePendingPermissionRequest.mockResolvedValue(undefined);
    installAdapter();
  });

  it('creates a provider session, persists its id, and sends the initial prompt through the adapter', async () => {
    const runtime = new ChatConversationRuntime();
    const conversation = makeConversation();
    vi.mocked(state.adapter.createSession).mockImplementationOnce(async (config) => {
      state.config = config;
      await config.onEvent({
        type: 'timeline',
        item: {
          id: 'assistant-1',
          kind: 'assistant_message',
          payload: { text: 'early hello' },
        },
        upsert: true,
      });
      return {
        conversationId: conversation.id,
        providerId: 'codex',
        providerSessionId: 'thread-1',
      };
    });

    await runtime.startConversation(conversation, ' hello ');

    expect(state.adapter.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation,
        cwd: '/repo',
        env: { FOO: 'bar' },
      })
    );
    expect(state.setProviderSessionId).toHaveBeenCalledWith('conversation-1', 'thread-1');
    expect(state.store.append).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-1' }),
      {
        id: 'assistant-1',
        kind: 'assistant_message',
        payload: { text: 'early hello' },
      },
      { upsert: true }
    );
    expect(state.store.appendUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-1' }),
      { text: 'hello' },
      { emit: false }
    );
    expect(state.adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-1' }),
      { text: 'hello' }
    );
    expect(state.store.markUserMessageDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-1' }),
      expect.objectContaining({ text: 'hello' })
    );
    expect(state.store.emitItem).toHaveBeenCalled();
    expect(state.conversationEmit).toHaveBeenCalledWith(
      'conversation:input-submitted',
      expect.objectContaining({ conversationId: 'conversation-1' })
    );
  });

  it('handles out-of-band slash commands without appending user messages', async () => {
    const adapter = installAdapter({
      tryHandleOutOfBandCommand: vi.fn(async () => true),
    });
    const runtime = new ChatConversationRuntime();

    await runtime.startConversation(makeConversation(), '/compact');

    expect(adapter.tryHandleOutOfBandCommand).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-1' }),
      { text: '/compact' }
    );
    expect(state.store.appendUserMessage).not.toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
    expect(state.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ conversationId: 'conversation-1', status: 'completed' })
    );
  });

  it('restores state and disposes the session when initial send fails', async () => {
    const adapter = installAdapter({
      sendMessage: vi.fn(async () => {
        throw new Error('send failed');
      }),
    });
    const runtime = new ChatConversationRuntime();

    await expect(runtime.startConversation(makeConversation(), 'hello')).rejects.toThrow(
      'send failed'
    );

    expect(state.store.deleteItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-1' }),
      'message-1'
    );
    expect(state.store.append).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-1' }),
      { kind: 'error', payload: { message: 'send failed' } }
    );
    expect(adapter.dispose).toHaveBeenCalled();
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'next' })
    ).rejects.toThrow('Conversation chat runtime is not active');
  });

  it('hydrates existing conversations and rejects unsupported SSH workspaces', async () => {
    const adapter = state.adapter;
    const runtime = new ChatConversationRuntime();
    const conversation = makeConversation({ providerSessionId: 'thread-2' });

    await runtime.hydrateConversation(conversation);
    await runtime.hydrateConversation({ ...conversation, title: 'Updated title' });

    expect(adapter.resumeSession).toHaveBeenCalledTimes(1);
    expect(adapter.resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation,
        cwd: '/repo',
      })
    );

    state.resolveTask.mockReturnValueOnce({ taskPath: '/repo', workspaceKind: 'ssh' });
    await expect(
      runtime.hydrateConversation(makeConversation({ id: 'ssh-conversation' }))
    ).rejects.toThrow('Codex chat runtime is only supported for local workspaces');
  });

  it('responds to permission requests and restores pending state when the adapter rejects', async () => {
    const adapter = installAdapter();
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await state.config.onEvent({ type: 'status', status: 'awaiting-input' });

    await runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });

    expect(state.store.resolvePermissionRequest).toHaveBeenCalled();
    expect(adapter.respondToPermission).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-1' }),
      expect.objectContaining({ requestId: 'permission-1' }),
      { requestId: 'permission-1', optionId: 'approve' }
    );

    expect(adapter.respondToPermission).toBeDefined();
    vi.mocked(adapter.respondToPermission!).mockRejectedValueOnce(new Error('permission failed'));
    await state.config.onEvent({ type: 'status', status: 'awaiting-input' });
    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('permission failed');

    expect(state.store.restorePendingPermissionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-1' }),
      expect.objectContaining({ requestId: 'permission-1' })
    );
  });

  it('cancels turns, lists commands, executes slash commands, and dehydrates task sessions', async () => {
    const adapter = installAdapter();
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(runtime.listCommands('project-1', 'task-1', 'conversation-1')).resolves.toEqual([
      { name: 'compact' },
    ]);
    await runtime.executeSlashCommand('project-1', 'task-1', 'conversation-1', { name: 'compact' });
    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.dehydrateTask('task-1');

    expect(adapter.executeSlashCommand).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-1' }),
      { name: 'compact' }
    );
    expect(adapter.cancel).toHaveBeenCalled();
    expect(state.store.append).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-1' }),
      {
        kind: 'reasoning',
        payload: { text: 'Turn cancelled.' },
      }
    );
    expect(adapter.dispose).toHaveBeenCalled();
    expect(runtime.isActive('conversation-1')).toBe(false);
  });

  it('surfaces cancellation errors and validates active conversation state', async () => {
    const adapter = installAdapter({
      cancel: vi.fn(async () => {
        throw new Error('Cannot interrupt Codex turn before app-server reports turn start');
      }),
    });
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(runtime.cancelTurn('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'Cannot interrupt Codex turn before app-server reports turn start'
    );
    expect(state.store.append).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-1' }),
      {
        kind: 'error',
        payload: { message: 'Failed to interrupt Codex app-server turn' },
      }
    );
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'after failure' });
    expect(adapter.sendMessage).toHaveBeenCalledWith(expect.any(Object), { text: 'after failure' });

    await state.config.onEvent({ type: 'status', status: 'awaiting-input' });
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'blocked' })
    ).rejects.toThrow('Agent is awaiting input');

    await expect(
      runtime.executeSlashCommand('project-1', 'task-1', 'missing-conversation', {
        name: 'compact',
      })
    ).rejects.toThrow('Conversation chat runtime is not active');
    expect(adapter.cancel).toHaveBeenCalled();
  });

  it('keeps active-turn state blocked when interrupt delivery fails', async () => {
    installAdapter({
      cancel: vi.fn(async () => {
        throw new Error('interrupt failed');
      }),
    });
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    await state.config.onEvent({ type: 'status', status: 'working' });

    await expect(runtime.cancelTurn('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'interrupt failed'
    );

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'still blocked' })
    ).rejects.toThrow('Agent is still responding');
    expect(state.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:status' }),
      expect.objectContaining({ status: 'working' })
    );
  });

  it('covers idle/working provider states and no-op lifecycle helpers', async () => {
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await state.config.onEvent({ type: 'status', status: 'working' });
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'blocked' })
    ).rejects.toThrow('Agent is still responding');

    await state.config.onEvent({ type: 'status', status: 'idle' });
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'next' });
    runtime.suppressBackendExitForTaskDuringStop('task-1')();
    runtime.suppressBackendExitDuringStop('conversation-1')();
    await runtime.cancelPendingPermissionRequestsForConversation('missing-conversation');
    await runtime.dehydrateConversation('missing-conversation');
    await runtime.abortHydratedConversation('conversation-1');

    expect(state.adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-1' }),
      { text: 'next' }
    );
    expect(state.adapter.dispose).toHaveBeenCalled();
  });

  it('restores permission and send state when store cleanup fails', async () => {
    const adapter = installAdapter({
      sendMessage: vi.fn(async () => {
        throw new Error('send failed');
      }),
    });
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());
    state.store.deleteItem.mockRejectedValueOnce(new Error('delete failed'));

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('send failed');

    vi.mocked(adapter.respondToPermission!).mockRejectedValueOnce(new Error('permission failed'));
    await state.config.onEvent({ type: 'status', status: 'awaiting-input' });
    state.store.restorePendingPermissionRequest.mockRejectedValueOnce(new Error('restore failed'));

    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('permission failed');

    expect(state.store.deleteItem).toHaveBeenCalled();
    expect(state.store.restorePendingPermissionRequest).toHaveBeenCalled();
  });

  it('reports unsupported command and permission adapter capabilities', async () => {
    installAdapter({
      executeSlashCommand: undefined,
      listCommands: undefined,
      respondToPermission: undefined,
    });
    const runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    await expect(runtime.listCommands('project-1', 'task-1', 'conversation-1')).resolves.toEqual(
      []
    );
    await expect(
      runtime.executeSlashCommand('project-1', 'task-1', 'conversation-1', { name: 'compact' })
    ).rejects.toThrow('Slash commands are not supported');

    await state.config.onEvent({ type: 'status', status: 'awaiting-input' });
    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('Permission responses are not supported');
  });
});

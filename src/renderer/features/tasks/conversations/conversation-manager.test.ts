import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManagerStore } from './conversation-manager';

const hydrateConversation = vi.hoisted(() => vi.fn());
const dehydrateConversation = vi.hoisted(() => vi.fn());
const getTimeline = vi.hoisted(() => vi.fn());
const sendMessage = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const listeners = vi.hoisted(() => ({
  status: undefined as
    | ((event: {
        projectId: string;
        taskId: string;
        conversationId: string;
        status: 'idle' | 'working' | 'awaiting-input' | 'error' | 'completed';
      }) => void)
    | undefined,
}));

vi.mock('@renderer/features/tasks/stores/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({
    onOpenExternal: vi.fn(),
    onOpenFile: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((channel, callback) => {
      if (channel.name === 'conversation:status') {
        listeners.status = callback;
        return () => {
          listeners.status = undefined;
        };
      }
      return () => {};
    }),
  },
  rpc: {
    conversations: {
      dehydrateConversation,
      getConversationsForTask: vi.fn(),
      getTimeline,
      hydrateConversation,
      sendMessage,
    },
  },
}));

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: class {
    constructor(readonly sessionId: string) {}

    connect = frontendConnect;
    dispose = frontendDispose;
  },
}));

describe('ConversationManagerStore session hydration', () => {
  beforeEach(() => {
    listeners.status = undefined;
    hydrateConversation.mockReset();
    dehydrateConversation.mockReset();
    getTimeline.mockReset();
    sendMessage.mockReset();
    frontendConnect.mockReset();
    frontendDispose.mockReset();

    hydrateConversation.mockResolvedValue(undefined);
    dehydrateConversation.mockResolvedValue(undefined);
    getTimeline.mockResolvedValue([]);
    sendMessage.mockResolvedValue({
      item: {
        id: 'message-1',
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 1,
        text: 'hello',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    });
    frontendConnect.mockResolvedValue(undefined);
  });

  it('does not hydrate conversations from the PTY session connect path', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Conversation 1',
        lastInteractedAt: null,
        isInitialConversation: false,
        runtimeMode: 'terminal',
      },
    ]);

    const session = store.sessions.get('conversation-1');
    expect(session).toBeDefined();

    await session?.connect();

    expect(hydrateConversation).not.toHaveBeenCalled();
    expect(frontendConnect).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it('creates a PTY fallback session for chat conversations without a runnable chat runtime', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'grok',
        title: 'Conversation 1',
        lastInteractedAt: null,
        isInitialConversation: false,
        runtimeMode: 'chat',
      },
    ]);

    expect(store.conversations.get('conversation-1')).toBeDefined();
    expect(store.sessions.get('conversation-1')).toBeDefined();
    expect(frontendConnect).not.toHaveBeenCalled();

    store.dispose();
  });

  it('does not create a PTY session for runnable Codex chat conversations', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Conversation 1',
        lastInteractedAt: null,
        isInitialConversation: false,
        runtimeMode: 'chat',
      },
    ]);

    expect(store.conversations.get('conversation-1')).toBeDefined();
    expect(store.sessions.get('conversation-1')).toBeUndefined();
    expect(frontendConnect).not.toHaveBeenCalled();

    store.dispose();
  });

  it('creates a timeline store and sends messages for runnable chat conversations', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Conversation 1',
        lastInteractedAt: null,
        isInitialConversation: false,
        runtimeMode: 'chat',
      },
    ]);

    expect(store.sessions.get('conversation-1')).toBeUndefined();
    expect(store.timelines.get('conversation-1')).toBeDefined();
    expect(getTimeline).not.toHaveBeenCalled();

    await store.sendMessage('conversation-1', 'hello');

    expect(sendMessage).toHaveBeenCalledWith('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    expect(store.conversations.get('conversation-1')?.status).toBe('working');

    store.dispose();
  });

  it('disposes and recreates chat timelines across dehydrate and hydrate', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Conversation 1',
        lastInteractedAt: null,
        isInitialConversation: false,
        runtimeMode: 'chat',
      },
    ]);

    const originalTimeline = store.timelines.get('conversation-1');
    expect(originalTimeline).toBeDefined();

    await store.dehydrateConversation('conversation-1');

    expect(dehydrateConversation).toHaveBeenCalledWith('project-1', 'task-1', 'conversation-1');
    expect(store.timelines.get('conversation-1')).toBeUndefined();

    await store.hydrateConversation('conversation-1');

    expect(hydrateConversation).toHaveBeenCalledWith('project-1', 'task-1', 'conversation-1');
    expect(store.timelines.get('conversation-1')).toBeDefined();
    expect(store.timelines.get('conversation-1')).not.toBe(originalTimeline);

    store.dispose();
  });

  it('keeps chat timeline state when dehydrate fails', async () => {
    dehydrateConversation.mockRejectedValueOnce(new Error('stop failed'));
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Conversation 1',
        lastInteractedAt: null,
        isInitialConversation: false,
        runtimeMode: 'chat',
      },
    ]);

    const timeline = store.timelines.get('conversation-1');
    await expect(store.dehydrateConversation('conversation-1')).rejects.toThrow('stop failed');

    expect(store.timelines.get('conversation-1')).toBe(timeline);

    store.dispose();
  });

  it('updates conversation status from chat runtime status events', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Conversation 1',
        lastInteractedAt: null,
        isInitialConversation: false,
        runtimeMode: 'chat',
      },
    ]);

    listeners.status?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'completed',
    });
    listeners.status?.({
      projectId: 'other-project',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      status: 'error',
    });

    expect(store.conversations.get('conversation-1')?.status).toBe('completed');

    store.dispose();
    expect(listeners.status).toBeUndefined();
  });
});

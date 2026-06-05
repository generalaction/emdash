import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManagerStore } from './conversation-manager';

const hydrateConversation = vi.hoisted(() => vi.fn());
const dehydrateConversation = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const eventHandlers = vi.hoisted(() => new Map<string, Set<(data: unknown) => void>>());

vi.mock('@renderer/features/tasks/stores/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({
    onOpenExternal: vi.fn(),
    onOpenFile: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: (event: { name: string }, cb: (data: unknown) => void) => {
      const set = eventHandlers.get(event.name) ?? new Set<(data: unknown) => void>();
      set.add(cb);
      eventHandlers.set(event.name, set);
      return () => set.delete(cb);
    },
  },
  rpc: {
    conversations: {
      dehydrateConversation,
      getConversationsForTask: vi.fn(),
      hydrateConversation,
    },
  },
}));

function emitTestEvent(channel: string, data: unknown): void {
  for (const cb of eventHandlers.get(channel) ?? []) cb(data);
}

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: class {
    constructor(readonly sessionId: string) {}

    connect = frontendConnect;
    dispose = frontendDispose;
  },
}));

describe('ConversationManagerStore session hydration', () => {
  beforeEach(() => {
    hydrateConversation.mockReset();
    dehydrateConversation.mockReset();
    frontendConnect.mockReset();
    frontendDispose.mockReset();
    eventHandlers.clear();

    hydrateConversation.mockResolvedValue(undefined);
    dehydrateConversation.mockResolvedValue(undefined);
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
      },
    ]);

    const session = store.sessions.get('conversation-1');
    expect(session).toBeDefined();

    await session?.connect();

    expect(hydrateConversation).not.toHaveBeenCalled();
    expect(frontendConnect).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it('reconciles optimistic conversations with authoritative created events', () => {
    // Task creation seeds an optimistic record before the main process decides
    // fields like uiMode; the conversation:created event must merge them in.
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Codex (1)',
        lastInteractedAt: null,
        autoApprove: true,
        isInitialConversation: true,
      },
    ]);

    emitTestEvent('conversation:created', {
      conversation: {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Codex (1)',
        lastInteractedAt: '2026-06-05T00:00:00.000Z',
        autoApprove: true,
        uiMode: 'native-chat',
        isInitialConversation: true,
      },
    });

    const data = store.conversations.get('conversation-1')?.data;
    expect(data?.uiMode).toBe('native-chat');
    expect(data?.lastInteractedAt).toBe('2026-06-05T00:00:00.000Z');

    store.dispose();
  });
});

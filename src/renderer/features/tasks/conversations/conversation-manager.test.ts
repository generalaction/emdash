import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManagerStore, ConversationStore } from './conversation-manager';

const hydrateConversation = vi.hoisted(() => vi.fn());
const dehydrateConversation = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());

vi.mock('@renderer/features/tasks/stores/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({
    onOpenExternal: vi.fn(),
    onOpenFile: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: () => () => {} },
  rpc: {
    conversations: {
      dehydrateConversation,
      getConversationsForTask: vi.fn(),
      hydrateConversation,
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
    hydrateConversation.mockReset();
    dehydrateConversation.mockReset();
    frontendConnect.mockReset();
    frontendDispose.mockReset();

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
});

describe('Conversation unread state', () => {
  it('marks a seen completed conversation as unread', () => {
    const store = new ConversationStore({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'codex',
      title: 'Conversation 1',
      lastInteractedAt: null,
      isInitialConversation: false,
    });

    store.setStatus('completed');
    store.markSeen();

    expect(store.canMarkUnread).toBe(true);

    store.markUnread();

    expect(store.seen).toBe(false);
    expect(store.indicatorStatus).toBe('completed');
    expect(store.canMarkUnread).toBe(false);
  });

  it('marks the latest readable conversation as unread for task menus', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'older',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Older',
        lastInteractedAt: '2026-05-27T10:00:00.000Z',
        isInitialConversation: false,
      },
      {
        id: 'newer',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Newer',
        lastInteractedAt: '2026-05-28T10:00:00.000Z',
        isInitialConversation: false,
      },
    ]);

    const older = store.conversations.get('older')!;
    const newer = store.conversations.get('newer')!;
    older.setStatus('completed');
    older.markSeen();
    newer.setStatus('error');
    newer.markSeen();

    store.markLatestConversationUnread();

    expect(older.seen).toBe(true);
    expect(newer.seen).toBe(false);

    store.dispose();
  });
});

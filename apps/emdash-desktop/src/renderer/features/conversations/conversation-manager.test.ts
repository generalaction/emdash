import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManagerStore } from './conversation-manager';

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

  it('marks only starting and running TUI sessions active', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', []);

    (
      store as unknown as {
        handleTuiSessionListChanged(list: Record<string, unknown>): void;
      }
    ).handleTuiSessionListChanged({
      starting: {
        conversationId: 'starting',
        providerId: 'codex',
        sessionId: null,
        status: 'starting',
        cols: 80,
        rows: 24,
        resume: null,
        startedAt: 1,
      },
      running: {
        conversationId: 'running',
        providerId: 'codex',
        sessionId: null,
        status: 'running',
        cols: 80,
        rows: 24,
        resume: null,
        startedAt: 1,
      },
      exited: {
        conversationId: 'exited',
        providerId: 'codex',
        sessionId: null,
        status: 'exited',
        cols: 80,
        rows: 24,
        resume: null,
        startedAt: 1,
      },
    });

    expect(store.activeTuiSessionIds.has('starting')).toBe(true);
    expect(store.activeTuiSessionIds.has('running')).toBe(true);
    expect(store.activeTuiSessionIds.has('exited')).toBe(false);

    store.dispose();
  });

  it('marks closed ACP sessions inactive', () => {
    const store = new ConversationManagerStore('project-1', 'task-1', []);

    (
      store as unknown as {
        handleAcpSessionListChanged(list: Record<string, unknown>): void;
      }
    ).handleAcpSessionListChanged({
      ready: acpSession('ready', 'ready'),
      closed: acpSession('closed', 'closed'),
    });

    expect(store.activeAcpSessionIds.has('ready')).toBe(true);
    expect(store.activeAcpSessionIds.has('closed')).toBe(false);

    store.dispose();
  });
});

function acpSession(conversationId: string, lifecycle: 'ready' | 'closed') {
  return {
    conversationId,
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    lifecycle,
    isGenerating: false,
    lastStopReason: null,
    pendingPermissionCount: 0,
    backgroundAgentCount: 0,
    queuedPromptCount: 0,
    title: null,
    updatedAt: 1,
  };
}

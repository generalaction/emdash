import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { ConversationManagerStore } from './conversation-manager';

const hydrateConversation = vi.hoisted(() => vi.fn());
const dehydrateConversation = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const eventHandlers = vi.hoisted(() => new Map<unknown, Array<(event: unknown) => void>>());

vi.mock('@renderer/features/tasks/stores/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({
    onOpenExternal: vi.fn(),
    onOpenFile: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: (channel: unknown, handler: (event: unknown) => void) => {
      const handlers = eventHandlers.get(channel) ?? [];
      handlers.push(handler);
      eventHandlers.set(channel, handlers);
      return () => {
        const next = (eventHandlers.get(channel) ?? []).filter((h) => h !== handler);
        eventHandlers.set(channel, next);
      };
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

  it('clears working task status when an agent session exits', () => {
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

    store.conversations.get('conversation-1')?.setWorking();
    expect(store.taskStatus).toBe('working');

    for (const handler of eventHandlers.get(agentSessionExitedChannel) ?? []) {
      handler({ conversationId: 'conversation-1', taskId: 'task-1' });
    }

    expect(store.taskStatus).toBeNull();

    store.dispose();
  });
});

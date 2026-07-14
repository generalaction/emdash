import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentSessionExitedChannel,
  type AgentSessionExited,
} from '@shared/core/agents/agentEvents';
import { ConversationManagerStore } from './conversation-manager';

const hydrateConversation = vi.hoisted(() => vi.fn());
const dehydrateConversation = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const eventsOn = vi.hoisted(() =>
  vi.fn((_channel: unknown, _listener: (event: AgentSessionExited) => void) => () => {})
);

vi.mock('@renderer/features/tasks/stores/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({
    onOpenExternal: vi.fn(),
    onOpenFile: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: eventsOn },
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
    eventsOn.mockClear();

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

  it('ignores session exits from another project with the same task id', () => {
    const conversation = {
      id: 'conversation-1',
      taskId: 'task-1',
      providerId: 'codex',
      title: 'Conversation 1',
      lastInteractedAt: null,
      isInitialConversation: false,
      agentStatus: 'working' as const,
    };
    const first = new ConversationManagerStore('project-1', 'task-1', [
      { ...conversation, projectId: 'project-1' },
    ]);
    const second = new ConversationManagerStore('project-2', 'task-1', [
      { ...conversation, projectId: 'project-2' },
    ]);
    const exitListeners = eventsOn.mock.calls
      .filter(([channel]) => channel === agentSessionExitedChannel)
      .map(([, listener]) => listener);

    for (const listener of exitListeners) {
      listener({ conversationId: 'conversation-1', projectId: 'project-1', taskId: 'task-1' });
    }

    expect(first.conversations.get('conversation-1')?.status).toBe('idle');
    expect(second.conversations.get('conversation-1')?.status).toBe('working');

    first.dispose();
    second.dispose();
  });
});

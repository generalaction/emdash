import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { ConversationManagerStore } from './conversation-manager';

const hydrateConversation = vi.hoisted(() => vi.fn());
const dehydrateConversation = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const frontendOptions = vi.hoisted(() => [] as Array<{ windowsPtyBackend?: string }>);

vi.mock('@renderer/features/tasks/stores/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({
    onOpenExternal: vi.fn(),
    onOpenFile: vi.fn(),
  }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectSshConnectionId: vi.fn(() => undefined),
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
    constructor(
      readonly sessionId: string,
      _theme?: unknown,
      _onOpenFile?: unknown,
      _onOpenExternal?: unknown,
      options?: { windowsPtyBackend?: string }
    ) {
      frontendOptions.push(options ?? {});
    }

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
    frontendOptions.length = 0;

    hydrateConversation.mockResolvedValue(undefined);
    dehydrateConversation.mockResolvedValue(undefined);
    frontendConnect.mockResolvedValue(undefined);
    vi.mocked(getProjectSshConnectionId).mockReturnValue(undefined);
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
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

  it('uses a later SSH connection id when connecting a pre-created conversation session', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
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

    store.setSshConnectionId('ssh-1');
    await store.sessions.get('conversation-1')?.connect();

    expect(frontendOptions[0]?.windowsPtyBackend).toBeUndefined();

    store.dispose();
  });
});

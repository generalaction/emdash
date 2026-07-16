import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManagerStore } from './conversation-manager';

const acquireLease = vi.hoisted(() => vi.fn());
const releaseLease = vi.hoisted(() => vi.fn());
const releaseLeaseOwner = vi.hoisted(() => vi.fn());
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
      getConversationsForTask: vi.fn(),
    },
    sessionLeases: {
      acquire: acquireLease,
      release: releaseLease,
      releaseOwner: releaseLeaseOwner,
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
    acquireLease.mockReset();
    releaseLease.mockReset();
    releaseLeaseOwner.mockReset();
    frontendConnect.mockReset();
    frontendDispose.mockReset();

    acquireLease.mockResolvedValue({ id: 'lease-1' });
    releaseLease.mockResolvedValue(undefined);
    releaseLeaseOwner.mockResolvedValue(undefined);
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

    expect(acquireLease).not.toHaveBeenCalled();
    expect(frontendConnect).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it('acquires the matching shared lease for an ACP conversation', async () => {
    const store = new ConversationManagerStore('project-1', 'task-1', [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Conversation 1',
        type: 'acp',
        lastInteractedAt: null,
        isInitialConversation: false,
      },
    ]);

    await store.hydrateConversation('conversation-1');

    expect(acquireLease).toHaveBeenCalledWith({
      kind: 'acp',
      projectId: 'project-1',
      taskId: 'task-1',
      resourceId: 'conversation-1',
      ownerType: 'desktop',
      ownerId: expect.any(String),
    });

    await store.dehydrateConversation('conversation-1');
    expect(releaseLease).toHaveBeenCalledWith('lease-1');
    store.dispose();
  });

  it('releases a lease that finishes acquiring after disposal', async () => {
    let resolveAcquire: ((value: { id: string }) => void) | undefined;
    acquireLease.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        resolveAcquire = resolve;
      })
    );
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

    const hydrate = store.hydrateConversation('conversation-1');
    store.dispose();
    resolveAcquire?.({ id: 'late-lease' });
    await hydrate;

    expect(releaseLease).toHaveBeenCalledWith('late-lease');
  });
});

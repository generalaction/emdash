import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManagerStore } from '@core/features/conversations/api/browser/conversation-manager';
import type { Conversation, ConversationEvent } from '@core/primitives/conversations/api';

const { client, listeners } = vi.hoisted(() => ({
  client: {
    getConversationsForTask: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    markConversationSeen: vi.fn(),
    events: { subscribe: vi.fn() },
    tui: { sessions: {} },
    acp: { sessions: {} },
  },
  listeners: new Set<(event: ConversationEvent) => void>(),
}));

vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => client,
}));
vi.mock('@core/features/editor/api/browser/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({ onOpenExternal: vi.fn(), onOpenFile: vi.fn() }),
}));
vi.mock('@core/features/terminals/api/browser/pty/pty', () => ({
  FrontendPty: class {
    connect = vi.fn();
    dispose = vi.fn();
  },
}));
// Runtime liveness is independent of the authoritative conversation inventory.
vi.mock('@emdash/wire/state', () => ({
  remote: () => () => ({ states: { list: {} } }),
  observe: () => {},
}));

const managers: ConversationManagerStore[] = [];
const conversation = (id = 'conversation-1'): Conversation => ({
  id,
  projectId: 'project-1',
  taskId: 'task-1',
  providerId: 'codex',
  type: 'acp',
  title: id,
  lastInteractedAt: null,
  isInitialConversation: false,
  agentStatus: 'awaiting-input',
  agentStatusSeen: false,
});

beforeEach(() => {
  vi.stubGlobal('window', {});
  client.getConversationsForTask.mockResolvedValue([conversation()]);
  client.deleteConversation.mockResolvedValue(undefined);
  client.events.subscribe.mockImplementation(async (_key, observer) => {
    listeners.add(observer.onEvent);
    return () => listeners.delete(observer.onEvent);
  });
});

afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
  listeners.clear();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function createManager() {
  const manager = new ConversationManagerStore('project-1', 'task-1', undefined, () =>
    formatHostRef(LOCAL_HOST_REF)
  );
  managers.push(manager);
  await manager.list.load();
  return manager;
}

function emit(event: ConversationEvent) {
  for (const listener of listeners) listener(event);
}

const deleted = (): Extract<ConversationEvent, { type: 'deleted' }> => ({
  type: 'deleted',
  conversationId: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
});

describe('conversation membership and task attention', () => {
  it('removes missing conversations and destroys their frontend sessions on reload', async () => {
    const manager = await createManager();
    const session = manager.sessions.get('conversation-1');
    if (!session) throw new Error('Missing session');
    const destroy = vi.spyOn(session, 'destroy');
    expect(manager.taskStatus).toBe('awaiting-input');

    client.getConversationsForTask.mockResolvedValue([]);
    await manager.list.load();

    expect(manager.conversations.size).toBe(0);
    expect(manager.sessions.size).toBe(0);
    expect(manager.taskStatus).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('preserves conversations and their status when a reload fails', async () => {
    const manager = await createManager();
    client.getConversationsForTask.mockRejectedValue(new Error('Disconnected'));
    await manager.list.load();
    expect(manager.list.error).toBe('Disconnected');
    expect(manager.conversations.size).toBe(1);
    expect(manager.taskStatus).toBe('awaiting-input');
  });

  it('recovers a missed deletion when the event stream reports a gap', async () => {
    const manager = await createManager();
    client.getConversationsForTask.mockResolvedValue([]);
    const observer = client.events.subscribe.mock.calls[0]?.[1];
    expect(observer).toBeDefined();
    observer.onGap();
    await manager.list.load();
    expect(manager.conversations.size).toBe(0);
    expect(manager.taskStatus).toBeNull();
  });

  it.each(['creation', 'deletion'] as const)(
    'refetches a missed %s when a gap arrives during an existing reload',
    async (change) => {
      const manager = await createManager();
      const stale = deferred<Conversation[]>();
      const fresh = change === 'creation' ? [conversation(), conversation('conversation-2')] : [];
      client.getConversationsForTask.mockReturnValueOnce(stale.promise).mockResolvedValue(fresh);
      const loading = manager.list.load();
      await vi.waitFor(() => expect(client.getConversationsForTask).toHaveBeenCalledTimes(2));

      // Every subscription can report the same gap; they should queue one fresh fetch.
      for (const [, observer] of client.events.subscribe.mock.calls) observer.onGap();
      stale.resolve([conversation()]);
      await loading;

      await vi.waitFor(() => {
        expect(client.getConversationsForTask).toHaveBeenCalledTimes(3);
        expect([...manager.conversations.keys()]).toEqual(fresh.map((record) => record.id));
        expect(manager.taskStatus).toBe(change === 'creation' ? 'awaiting-input' : null);
      });
    }
  );

  it('removes conversations when deletion arrives from another surface', async () => {
    const manager = await createManager();
    emit({ ...deleted(), projectId: 'other-project' });
    expect(manager.conversations.size).toBe(1);
    emit(deleted());
    expect(manager.conversations.size).toBe(0);
    expect(manager.sessions.size).toBe(0);
    expect(manager.taskStatus).toBeNull();
  });

  it.each(['event', 'command'] as const)(
    'preserves a concurrent creation from a %s across an older reload',
    async (source) => {
      const manager = await createManager();
      const pending = deferred<Conversation[]>();
      client.getConversationsForTask.mockReturnValue(pending.promise);
      const loading = manager.list.load();
      await vi.waitFor(() => expect(client.getConversationsForTask).toHaveBeenCalledTimes(2));
      const created = conversation('conversation-2');
      if (source === 'event') {
        emit({ type: 'created', conversation: created });
      } else {
        client.createConversation.mockResolvedValue({ success: true, data: created });
        await manager.createConversation({
          id: created.id,
          projectId: created.projectId,
          taskId: created.taskId,
          provider: 'codex',
          title: created.title,
          type: 'acp',
        });
      }
      pending.resolve([]);
      await loading;
      expect([...manager.conversations.keys()]).toEqual(['conversation-2']);
      expect(manager.sessions.has('conversation-2')).toBe(true);

      client.getConversationsForTask.mockResolvedValue([]);
      await manager.list.load();
      expect(manager.conversations.size).toBe(0);
    }
  );

  it.each(['event', 'command'] as const)(
    'does not resurrect a conversation deleted by a %s during an older reload',
    async (source) => {
      const manager = await createManager();
      const pending = deferred<Conversation[]>();
      client.getConversationsForTask.mockReturnValue(pending.promise);
      const loading = manager.list.load();
      if (source === 'event') emit(deleted());
      else await manager.deleteConversation('conversation-1');
      pending.resolve([conversation()]);
      await loading;
      expect(manager.conversations.size).toBe(0);
      expect(manager.taskStatus).toBeNull();
    }
  );

  it('keeps optimistic deletion hidden during reload and restores the original stores on failure', async () => {
    const manager = await createManager();
    const original = manager.conversations.get('conversation-1');
    const session = manager.sessions.get('conversation-1');
    const pending = deferred<void>();
    client.deleteConversation.mockReturnValue(pending.promise);
    const deleting = manager.deleteConversation('conversation-1');
    const failed = expect(deleting).rejects.toThrow('Delete failed');
    await manager.list.load();
    const sizeWhileDeleting = manager.conversations.size;
    pending.reject(new Error('Delete failed'));
    await failed;
    expect(sizeWhileDeleting).toBe(0);
    expect(manager.conversations.get('conversation-1')).toBe(original);
    expect(manager.sessions.get('conversation-1')).toBe(session);
    expect(manager.taskStatus).toBe('awaiting-input');
  });

  it('does not roll back a confirmed deletion if its command response is lost', async () => {
    const manager = await createManager();
    const pending = deferred<void>();
    client.deleteConversation.mockReturnValue(pending.promise);
    const deleting = manager.deleteConversation('conversation-1');
    const failed = expect(deleting).rejects.toThrow('Response lost');
    emit(deleted());
    pending.reject(new Error('Response lost'));
    await failed;
    expect(manager.conversations.size).toBe(0);
    expect(manager.taskStatus).toBeNull();
  });

  it('does not populate stores after disposal while loading', async () => {
    const manager = await createManager();
    const pending = deferred<Conversation[]>();
    client.getConversationsForTask.mockReturnValue(pending.promise);
    const loading = manager.list.load();
    manager.dispose();
    pending.resolve([conversation('conversation-2')]);
    await loading;
    expect(manager.conversations.has('conversation-2')).toBe(false);
    expect(manager.sessions.has('conversation-2')).toBe(false);
  });
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

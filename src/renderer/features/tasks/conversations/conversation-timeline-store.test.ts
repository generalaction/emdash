import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationTimelineStore } from './conversation-timeline-store';

const listeners = vi.hoisted(() => ({
  timeline: undefined as
    | ((event: {
        projectId: string;
        taskId: string;
        conversationId: string;
        item: {
          id: string;
          conversationId: string;
          kind: 'user_message';
          sequence: number;
          text: string;
          createdAt: string;
        };
      }) => void)
    | undefined,
}));
const getTimeline = vi.hoisted(() => vi.fn());
const sendMessage = vi.hoisted(() => vi.fn());
const cancelTurn = vi.hoisted(() => vi.fn());
const respondToPermission = vi.hoisted(() => vi.fn());

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((_channel, cb) => {
      listeners.timeline = cb;
      return () => {
        listeners.timeline = undefined;
      };
    }),
  },
  rpc: {
    conversations: {
      cancelTurn,
      getTimeline,
      respondToPermission,
      sendMessage,
    },
  },
}));

describe('ConversationTimelineStore', () => {
  beforeEach(() => {
    listeners.timeline = undefined;
    getTimeline.mockReset();
    sendMessage.mockReset();
    cancelTurn.mockReset();
    respondToPermission.mockReset();
    getTimeline.mockResolvedValue([]);
    cancelTurn.mockResolvedValue(undefined);
    respondToPermission.mockResolvedValue(undefined);
    sendMessage.mockImplementation(
      async (
        _projectId: string,
        _taskId: string,
        _conversationId: string,
        input: { messageId: string; text: string }
      ) => ({
        item: {
          id: input.messageId,
          conversationId: 'conversation-1',
          kind: 'user_message',
          sequence: 1,
          text: input.text,
          createdAt: '2026-05-28T00:00:00.000Z',
        },
      })
    );
  });

  it('loads timeline items through RPC', async () => {
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');

    await store.load();

    expect(getTimeline).toHaveBeenCalledWith('project-1', 'task-1', 'conversation-1');

    store.dispose();
  });

  it('responds to permission requests through RPC', async () => {
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');

    await store.respondToPermission({ requestId: 'permission-1', optionId: 'approve' });

    expect(respondToPermission).toHaveBeenCalledWith('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });
  });

  it('upserts locally returned and event-delivered items', async () => {
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');
    store.start();

    await store.sendMessage('hello');
    const messageId = sendMessage.mock.calls[0]?.[3]?.messageId;
    listeners.timeline?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      item: {
        id: messageId,
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 1,
        text: 'hello again',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    });

    expect(store.items.data).toEqual([
      {
        id: messageId,
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 1,
        text: 'hello again',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    ]);

    store.dispose();
  });

  it('adds an optimistic user message while send RPC is pending', async () => {
    const send = deferred<{
      item: {
        id: string;
        conversationId: string;
        kind: 'user_message';
        sequence: number;
        text: string;
        createdAt: string;
      };
    }>();
    sendMessage.mockReturnValueOnce(send.promise);
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');

    const sendPromise = store.sendMessage(' hello ');
    const messageId = sendMessage.mock.calls[0]?.[3]?.messageId;

    expect(store.items.data).toMatchObject([
      {
        id: messageId,
        kind: 'user_message',
        sequence: 1,
        text: 'hello',
      },
    ]);
    expect(sendMessage).toHaveBeenCalledWith('project-1', 'task-1', 'conversation-1', {
      messageId,
      text: 'hello',
    });

    send.resolve({
      item: {
        id: messageId,
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 1,
        text: 'hello',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    });
    await sendPromise;

    expect(store.items.data?.[0]?.createdAt).toBe('2026-05-28T00:00:00.000Z');
  });

  it('removes the optimistic user message when send RPC fails', async () => {
    sendMessage.mockRejectedValueOnce(new Error('send failed'));
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');

    await expect(store.sendMessage('hello')).rejects.toThrow('send failed');

    expect(store.items.data).toEqual([]);
  });

  it('keeps a revealed user message when send RPC later rejects as cancelled', async () => {
    const send = deferred<{
      item: {
        id: string;
        conversationId: string;
        kind: 'user_message';
        sequence: number;
        text: string;
        createdAt: string;
      };
    }>();
    sendMessage.mockReturnValueOnce(send.promise);
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');
    store.start();

    const sendPromise = store.sendMessage('hello');
    const messageId = sendMessage.mock.calls[0]?.[3]?.messageId;
    listeners.timeline?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      item: {
        id: messageId,
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 10,
        text: 'hello',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    });
    send.reject(new Error('Message send was cancelled'));

    await expect(sendPromise).rejects.toThrow('Message send was cancelled');

    expect(store.items.data).toEqual([
      {
        id: messageId,
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 10,
        text: 'hello',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    ]);

    store.dispose();
  });

  it('keeps live items when an older timeline load resolves later', async () => {
    const staleLoad = deferred<[]>();
    getTimeline.mockReturnValueOnce(staleLoad.promise);
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');
    store.start();

    await store.sendMessage('hello');
    const messageId = sendMessage.mock.calls[0]?.[3]?.messageId;
    staleLoad.resolve([]);
    await staleLoad.promise;
    await Promise.resolve();

    expect(store.items.data).toEqual([
      {
        id: messageId,
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 1,
        text: 'hello',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    ]);

    store.dispose();
  });

  it('cancels turns through RPC', async () => {
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');

    await store.cancelTurn();

    expect(cancelTurn).toHaveBeenCalledWith('project-1', 'task-1', 'conversation-1');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

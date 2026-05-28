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
      getTimeline,
      sendMessage,
    },
  },
}));

describe('ConversationTimelineStore', () => {
  beforeEach(() => {
    listeners.timeline = undefined;
    getTimeline.mockReset();
    sendMessage.mockReset();
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
  });

  it('loads timeline items through RPC', async () => {
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');

    await store.load();

    expect(getTimeline).toHaveBeenCalledWith('project-1', 'task-1', 'conversation-1');

    store.dispose();
  });

  it('upserts locally returned and event-delivered items', async () => {
    const store = new ConversationTimelineStore('project-1', 'task-1', 'conversation-1');
    store.start();

    await store.sendMessage('hello');
    listeners.timeline?.({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      item: {
        id: 'message-1',
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 1,
        text: 'hello again',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    });

    expect(store.items.data).toEqual([
      {
        id: 'message-1',
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 1,
        text: 'hello again',
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
    staleLoad.resolve([]);
    await staleLoad.promise;
    await Promise.resolve();

    expect(store.items.data).toEqual([
      {
        id: 'message-1',
        conversationId: 'conversation-1',
        kind: 'user_message',
        sequence: 1,
        text: 'hello',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    ]);

    store.dispose();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

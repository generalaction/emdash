import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversations } from '@main/db/schema';
import type { Conversation } from '@shared/conversations';
import { ChatConversationRuntime } from './chat-conversation-runtime';
import { chatTimelineStore } from './chat-timeline-store';

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  emit: vi.fn(),
  emitConversationEvent: vi.fn(),
  interruptSession: vi.fn(),
  resolveTask: vi.fn(),
  sendInput: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return mocks.db ?? {};
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
  },
}));

vi.mock('@main/core/conversations/conversation-events', () => ({
  conversationEvents: {
    _emit: mocks.emitConversationEvent,
  },
}));

vi.mock('../../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    lastInteractedAt: null,
    isInitialConversation: false,
    runtimeMode: 'chat',
    ...overrides,
  };
}

async function seedChatConversation(fixture: Awaited<ReturnType<typeof openFixture>>) {
  fixture.sqlite
    .prepare(
      `INSERT INTO projects (id, name, path, created_at, updated_at)
       VALUES ('project-1', 'Project', '/repo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .run();
  fixture.sqlite
    .prepare(
      `INSERT INTO tasks (
         id,
         project_id,
         name,
         status,
         created_at,
         updated_at,
         status_changed_at
       )
       VALUES (
         'task-1',
         'project-1',
         'Task',
         'in_progress',
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP
       )`
    )
    .run();

  await fixture.db.insert(conversations).values({
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    title: 'Conversation 1',
    provider: 'codex',
    runtimeMode: 'chat',
  });
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ChatConversationRuntime', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let runtime: ChatConversationRuntime;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    mocks.sendInput.mockResolvedValue(undefined);
    mocks.interruptSession.mockResolvedValue(undefined);
    mocks.resolveTask.mockReturnValue({
      conversations: {
        interruptSession: mocks.interruptSession,
        sendInput: mocks.sendInput,
      },
    });
    runtime = new ChatConversationRuntime();
  });

  afterEach(async () => {
    await runtime.dehydrateConversation('conversation-1');
    vi.restoreAllMocks();
    fixture.close();
    mocks.db = undefined;
  });

  it('does not leave an active runtime when initial timeline persistence fails', async () => {
    await expect(runtime.startConversation(makeConversation(), 'hello')).rejects.toThrow(
      'Conversation not found'
    );

    expect(runtime.isActive('conversation-1')).toBe(false);
  });

  it('requires an active runtime before sending a message', async () => {
    await seedChatConversation(fixture);

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('Conversation chat runtime is not active');
  });

  it('persists and writes messages to the active backend provider', async () => {
    await seedChatConversation(fixture);
    await runtime.hydrateConversation(makeConversation());

    const result = await runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });

    expect(result.item).toMatchObject({ kind: 'user_message', text: 'hello' });
    expect(mocks.sendInput).toHaveBeenCalledWith(
      'conversation-1',
      expect.stringContaining('hello')
    );
    expect(mocks.emitConversationEvent).toHaveBeenCalledWith(
      'conversation:input-submitted',
      expect.objectContaining({ conversationId: 'conversation-1' })
    );
  });

  it('cancels stale pending permission requests during hydration', async () => {
    await seedChatConversation(fixture);
    await chatTimelineStore.append(
      makeConversation(),
      {
        id: 'permission-1',
        kind: 'permission_request',
        payload: {
          requestId: 'permission-1',
          title: 'Run command?',
          options: [{ id: 'approve', label: 'Approve', kind: 'primary' }],
          status: 'pending',
        },
      },
      { upsert: true }
    );

    await runtime.hydrateConversation(makeConversation());

    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toMatchObject([
      {
        id: 'permission-1',
        kind: 'permission_request',
        requestId: 'permission-1',
        status: 'cancelled',
      },
    ]);
  });

  it('reopens a cancelled requestless permission prompt during hydration replay', async () => {
    await seedChatConversation(fixture);
    await chatTimelineStore.append(
      makeConversation(),
      {
        id: 'codex-permission-1000',
        kind: 'permission_request',
        payload: {
          requestId: 'codex-permission-1000',
          title: 'Codex permission request',
          options: [
            { id: 'approve', label: 'Approve', kind: 'primary' },
            { id: 'deny', label: 'Deny', kind: 'danger' },
          ],
          status: 'pending',
        },
      },
      { upsert: true }
    );

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 2000,
      payload: { notificationType: 'permission_prompt' },
    });

    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toMatchObject([
      {
        id: 'codex-permission-1000',
        kind: 'permission_request',
        requestId: 'codex-permission-2000',
        status: 'pending',
      },
    ]);
    await runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'codex-permission-2000',
      optionId: 'approve',
    });
    expect(mocks.sendInput).toHaveBeenCalledWith('conversation-1', 'y\r');
  });

  it('keeps permission responses retryable when backend delivery fails', async () => {
    await seedChatConversation(fixture);
    await runtime.hydrateConversation(makeConversation());
    await runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' });
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 12345,
      payload: { notificationType: 'permission_prompt', requestId: 'permission-1' },
    });
    mocks.sendInput.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).rejects.toThrow('write failed');
    await expect(
      chatTimelineStore.getPendingPermissionRequest(makeConversation(), {
        requestId: 'permission-1',
        optionId: 'approve',
      })
    ).resolves.toMatchObject({ requestId: 'permission-1', status: 'pending' });

    await runtime.respondToPermission('project-1', 'task-1', 'conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
    });

    expect(mocks.sendInput).toHaveBeenLastCalledWith('conversation-1', 'y\r');
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'permission_request',
          requestId: 'permission-1',
          status: 'approved',
        }),
      ])
    );
  });

  it('does not rewrite historical cancelled permissions during requestless hydration replay', async () => {
    await seedChatConversation(fixture);
    await chatTimelineStore.append(
      makeConversation(),
      {
        id: 'old-permission',
        kind: 'permission_request',
        payload: {
          requestId: 'old-permission',
          title: 'Old request',
          options: [
            { id: 'approve', label: 'Approve', kind: 'primary' },
            { id: 'deny', label: 'Deny', kind: 'danger' },
          ],
          status: 'pending',
        },
      },
      { upsert: true }
    );
    await chatTimelineStore.cancelPendingPermissionRequests(makeConversation());
    await chatTimelineStore.append(
      makeConversation(),
      {
        id: 'stale-permission',
        kind: 'permission_request',
        payload: {
          requestId: 'stale-permission',
          title: 'Stale request',
          options: [
            { id: 'approve', label: 'Approve', kind: 'primary' },
            { id: 'deny', label: 'Deny', kind: 'danger' },
          ],
          status: 'pending',
        },
      },
      { upsert: true }
    );

    await runtime.hydrateConversation(makeConversation());
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 3000,
      payload: { notificationType: 'permission_prompt' },
    });

    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toMatchObject([
      {
        id: 'old-permission',
        kind: 'permission_request',
        requestId: 'old-permission',
        status: 'cancelled',
      },
      {
        id: 'stale-permission',
        kind: 'permission_request',
        requestId: 'codex-permission-3000',
        status: 'pending',
      },
    ]);
  });

  it('removes the silent user row when backend delivery fails', async () => {
    await seedChatConversation(fixture);
    await runtime.hydrateConversation(makeConversation());
    mocks.sendInput.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('write failed');

    const rows = fixture.sqlite
      .prepare(
        `SELECT kind, payload
         FROM conversation_timeline_items
         WHERE conversation_id = 'conversation-1'
         ORDER BY sequence`
      )
      .all() as Array<{ kind: string; payload: string }>;

    expect(rows).toEqual([
      {
        kind: 'error',
        payload: JSON.stringify({ message: 'Failed to send message to the agent backend' }),
      },
    ]);
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:timeline' }),
      expect.objectContaining({
        item: expect.objectContaining({ kind: 'user_message' }),
      })
    );
  });

  it('persists cancellation marker and ignores late provider timeline events', async () => {
    await seedChatConversation(fixture);
    await runtime.hydrateConversation(makeConversation());

    await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        notificationType: 'idle_prompt',
        lastAssistantMessage: 'late answer',
      },
    });

    const rows = fixture.sqlite
      .prepare(
        `SELECT kind, payload
         FROM conversation_timeline_items
         WHERE conversation_id = 'conversation-1'
         ORDER BY sequence`
      )
      .all() as Array<{ kind: string; payload: string }>;

    expect(mocks.interruptSession).toHaveBeenCalledWith('conversation-1');
    expect(rows).toEqual([
      {
        kind: 'reasoning',
        payload: JSON.stringify({ text: 'Turn cancelled.' }),
      },
    ]);
  });

  it('keeps the user row when cancellation completes after backend delivery succeeds', async () => {
    await seedChatConversation(fixture);
    await runtime.hydrateConversation(makeConversation());
    const send = deferred();
    const cancel = deferred();
    mocks.sendInput.mockReturnValueOnce(send.promise);
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);

    const sendPromise = runtime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalled());
    const cancelPromise = runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());

    send.resolve();
    cancel.resolve();
    await expect(sendPromise).rejects.toThrow('Message send was cancelled');
    await cancelPromise;

    const rows = fixture.sqlite
      .prepare(
        `SELECT kind, payload
         FROM conversation_timeline_items
         WHERE conversation_id = 'conversation-1'
         ORDER BY sequence`
      )
      .all() as Array<{ kind: string; payload: string }>;

    expect(rows).toEqual([
      {
        kind: 'user_message',
        payload: JSON.stringify({ text: 'hello' }),
      },
      {
        kind: 'reasoning',
        payload: JSON.stringify({ text: 'Turn cancelled.' }),
      },
    ]);
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:timeline' }),
      expect.objectContaining({
        item: expect.objectContaining({ kind: 'user_message' }),
      })
    );
  });

  it('does not recover a cancelled delivery-started row after restart', async () => {
    await seedChatConversation(fixture);
    const originalRuntime = runtime;
    await originalRuntime.hydrateConversation(makeConversation());
    const send = deferred();
    const cancel = deferred();
    mocks.sendInput.mockReturnValueOnce(send.promise);
    mocks.interruptSession.mockReturnValueOnce(cancel.promise);

    const sendPromise = originalRuntime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => {
      const rows = fixture.sqlite
        .prepare(
          `SELECT payload
           FROM conversation_timeline_items
           WHERE conversation_id = 'conversation-1' AND kind = 'user_message'`
        )
        .all() as Array<{ payload: string }>;
      expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({
        deliveryStatus: '__emdash_delivery_started__',
      });
    });

    const cancelPromise = originalRuntime.cancelTurn('project-1', 'task-1', 'conversation-1');
    await vi.waitFor(() => expect(mocks.interruptSession).toHaveBeenCalled());
    cancel.resolve();
    await cancelPromise;

    runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const rows = fixture.sqlite
      .prepare(
        `SELECT kind, payload
         FROM conversation_timeline_items
         WHERE conversation_id = 'conversation-1'
         ORDER BY sequence`
      )
      .all() as Array<{ kind: string; payload: string }>;
    expect(rows).toEqual([
      {
        kind: 'reasoning',
        payload: JSON.stringify({ text: 'Turn cancelled.' }),
      },
    ]);

    send.resolve();
    await expect(sendPromise).rejects.toThrow('Message send was cancelled');
  });

  it('reveals a delivered user row when late cancellation succeeds', async () => {
    await seedChatConversation(fixture);
    await runtime.hydrateConversation(makeConversation());
    const originalMarkDelivered =
      chatTimelineStore.markUserMessageDelivered.bind(chatTimelineStore);
    const markDelivered = vi
      .spyOn(chatTimelineStore, 'markUserMessageDelivered')
      .mockImplementationOnce(async (conversation, item) => {
        await originalMarkDelivered(conversation, item);
        await runtime.cancelTurn('project-1', 'task-1', 'conversation-1');
      });

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).rejects.toThrow('Message send was cancelled');

    expect(markDelivered).toHaveBeenCalled();
    const rows = fixture.sqlite
      .prepare(
        `SELECT kind, payload
         FROM conversation_timeline_items
         WHERE conversation_id = 'conversation-1'
         ORDER BY sequence`
      )
      .all() as Array<{ kind: string; payload: string }>;
    expect(rows).toEqual([
      {
        kind: 'user_message',
        payload: JSON.stringify({ text: 'hello' }),
      },
      {
        kind: 'reasoning',
        payload: JSON.stringify({ text: 'Turn cancelled.' }),
      },
    ]);
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:timeline' }),
      expect.objectContaining({
        item: expect.objectContaining({
          kind: 'user_message',
          text: 'hello',
        }),
      })
    );
  });

  it('does not recover a cancelled row when cancellation races delivery-start before backend input', async () => {
    await seedChatConversation(fixture);
    const originalRuntime = runtime;
    await originalRuntime.hydrateConversation(makeConversation());
    const deliveryStarted = deferred();
    const originalMarkDeliveryStarted =
      chatTimelineStore.markUserMessageDeliveryStarted.bind(chatTimelineStore);
    const markDeliveryStarted = vi
      .spyOn(chatTimelineStore, 'markUserMessageDeliveryStarted')
      .mockImplementationOnce(async (conversation, item) => {
        await deliveryStarted.promise;
        await originalMarkDeliveryStarted(conversation, item);
      });

    const sendPromise = originalRuntime.sendMessage('project-1', 'task-1', 'conversation-1', {
      text: 'hello',
    });
    await vi.waitFor(() => expect(markDeliveryStarted).toHaveBeenCalled());

    await originalRuntime.cancelTurn('project-1', 'task-1', 'conversation-1');
    deliveryStarted.resolve();
    await expect(sendPromise).rejects.toThrow('Message send was cancelled');

    expect(mocks.sendInput).not.toHaveBeenCalled();

    runtime = new ChatConversationRuntime();
    await runtime.hydrateConversation(makeConversation());

    const rows = fixture.sqlite
      .prepare(
        `SELECT kind, payload
         FROM conversation_timeline_items
         WHERE conversation_id = 'conversation-1'
         ORDER BY sequence`
      )
      .all() as Array<{ kind: string; payload: string }>;
    expect(rows).toEqual([
      {
        kind: 'reasoning',
        payload: JSON.stringify({ text: 'Turn cancelled.' }),
      },
    ]);
  });

  it('persists mapped assistant and error hook events', async () => {
    await seedChatConversation(fixture);
    await runtime.hydrateConversation(makeConversation());

    await runtime.recordAgentEvent({
      type: 'notification',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        lastAssistantMessage: 'done',
      },
    });
    await runtime.recordAgentEvent({
      type: 'error',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: Date.now(),
      payload: {
        message: 'failed',
      },
    });

    const rows = fixture.sqlite
      .prepare(
        `SELECT kind, payload
         FROM conversation_timeline_items
         WHERE conversation_id = 'conversation-1'
         ORDER BY sequence`
      )
      .all() as Array<{ kind: string; payload: string }>;

    expect(rows).toEqual([
      {
        kind: 'assistant_message',
        payload: JSON.stringify({ text: 'done' }),
      },
      {
        kind: 'error',
        payload: JSON.stringify({ message: 'failed' }),
      },
    ]);
  });
});

import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversations } from '@main/db/schema';
import type { AppendConversationTimelineItemInput } from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import { chatTimelineStore } from './chat-timeline-store';

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  emit: vi.fn(),
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

async function seedSecondChatConversation(fixture: Awaited<ReturnType<typeof openFixture>>) {
  await fixture.db.insert(conversations).values({
    id: 'conversation-2',
    projectId: 'project-1',
    taskId: 'task-1',
    title: 'Conversation 2',
    provider: 'codex',
    runtimeMode: 'chat',
  });
}

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

describe('ChatTimelineStore', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    await seedChatConversation(fixture);
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('appends timeline items with stable per-conversation sequence numbers', async () => {
    const conversation = makeConversation();
    const first = await chatTimelineStore.appendUserMessage(conversation, {
      messageId: 'message-1',
      text: ' hello ',
    });
    const second = await chatTimelineStore.append(conversation, {
      id: 'message-2',
      kind: 'assistant_message',
      payload: { text: 'hi' },
    });

    expect(first).toMatchObject({
      id: 'message-1',
      conversationId: 'conversation-1',
      sequence: 1,
      kind: 'user_message',
      text: 'hello',
    });
    expect(second).toMatchObject({ sequence: 2, kind: 'assistant_message', text: 'hi' });
    expect(mocks.emit).toHaveBeenCalledTimes(2);
  });

  it('lists timeline items after a sequence cursor', async () => {
    const conversation = makeConversation();
    await chatTimelineStore.append(conversation, {
      id: 'message-1',
      kind: 'user_message',
      payload: { text: 'one' },
    });
    await chatTimelineStore.append(conversation, {
      id: 'message-2',
      kind: 'assistant_message',
      payload: { text: 'two' },
    });

    const items = await chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1', {
      afterSequence: 1,
    });

    expect(items.map((item) => item.id)).toEqual(['message-2']);
  });

  it('updates stable tool call timeline rows without changing sequence', async () => {
    const conversation = makeConversation();
    await chatTimelineStore.append(
      conversation,
      {
        id: 'tool-1',
        kind: 'tool_call',
        payload: {
          toolName: 'shell',
          status: 'running',
          input: { command: 'pnpm test' },
        },
      },
      { upsert: true }
    );
    await chatTimelineStore.append(
      conversation,
      {
        id: 'tool-1',
        kind: 'tool_call',
        payload: {
          toolName: 'shell',
          status: 'completed',
          input: { command: 'pnpm test' },
          output: 'passed',
        },
      },
      { upsert: true }
    );

    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toMatchObject([
      {
        id: 'tool-1',
        sequence: 1,
        kind: 'tool_call',
        toolName: 'shell',
        status: 'completed',
        output: 'passed',
      },
    ]);
  });

  it('scopes stable provider timeline ids to each conversation', async () => {
    await seedSecondChatConversation(fixture);
    const firstConversation = makeConversation();
    const secondConversation = makeConversation({
      id: 'conversation-2',
      title: 'Conversation 2',
    });

    await chatTimelineStore.append(
      firstConversation,
      {
        id: 'tool-1',
        kind: 'tool_call',
        payload: { toolName: 'shell', status: 'running' },
      },
      { upsert: true }
    );
    await chatTimelineStore.append(
      secondConversation,
      {
        id: 'tool-1',
        kind: 'tool_call',
        payload: { toolName: 'shell', status: 'completed', output: 'done' },
      },
      { upsert: true }
    );

    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toMatchObject([{ id: 'tool-1', status: 'running' }]);
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-2')
    ).resolves.toMatchObject([{ id: 'tool-1', status: 'completed', output: 'done' }]);
  });

  it('resolves pending permission requests by request id', async () => {
    const conversation = makeConversation();
    await chatTimelineStore.append(conversation, {
      id: 'permission-item-1',
      kind: 'permission_request',
      payload: {
        requestId: 'permission-1',
        title: 'Run command?',
        body: 'Codex wants to run pnpm test.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'pending',
      },
    });

    const resolved = await chatTimelineStore.resolvePermissionRequest(conversation, {
      requestId: 'permission-1',
      optionId: 'deny',
    });

    expect(resolved).toMatchObject({
      id: 'permission-item-1',
      sequence: 1,
      kind: 'permission_request',
      requestId: 'permission-1',
      status: 'denied',
    });
    expect(mocks.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'conversation:timeline' }),
      expect.objectContaining({
        item: expect.objectContaining({
          id: 'permission-item-1',
          status: 'denied',
        }),
      })
    );
  });

  it('does not reopen resolved permission requests on duplicate pending upserts', async () => {
    const conversation = makeConversation();
    await chatTimelineStore.append(conversation, {
      id: 'permission-item-1',
      kind: 'permission_request',
      payload: {
        requestId: 'permission-1',
        title: 'Run command?',
        body: 'Codex wants to run pnpm test.',
        options: [
          { id: 'approve', label: 'Approve', kind: 'primary' },
          { id: 'deny', label: 'Deny', kind: 'danger' },
        ],
        status: 'pending',
      },
    });
    await chatTimelineStore.resolvePermissionRequest(conversation, {
      requestId: 'permission-1',
      optionId: 'deny',
    });

    const upserted = await chatTimelineStore.append(
      conversation,
      {
        id: 'permission-item-1',
        kind: 'permission_request',
        payload: {
          requestId: 'permission-1',
          title: 'Run command?',
          body: 'Codex wants to run pnpm test.',
          options: [
            { id: 'approve', label: 'Approve', kind: 'primary' },
            { id: 'deny', label: 'Deny', kind: 'danger' },
          ],
          status: 'pending',
        },
      },
      { upsert: true }
    );

    expect(upserted).toMatchObject({
      id: 'permission-item-1',
      kind: 'permission_request',
      status: 'denied',
    });
    await expect(
      chatTimelineStore.getPendingPermissionRequest(conversation, {
        requestId: 'permission-1',
        optionId: 'deny',
      })
    ).rejects.toThrow('Permission request is not pending');
  });

  it('marks all pending permission requests cancelled', async () => {
    const conversation = makeConversation();
    await chatTimelineStore.append(
      conversation,
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

    await chatTimelineStore.cancelPendingPermissionRequests(conversation);

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

  it('keeps silently appended user messages hidden until they are emitted', async () => {
    const conversation = makeConversation();
    const item = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'pending',
      },
      { emit: false }
    );

    const pendingRows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-1'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(pendingRows[0]?.payload ?? '{}')).toMatchObject({
      text: 'pending',
      deliveryStatus: '__emdash_pending_delivery__',
    });
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toEqual([]);

    await chatTimelineStore.markUserMessageDelivered(conversation, item);
    const deliveredPendingRows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-1'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(deliveredPendingRows[0]?.payload ?? '{}')).toMatchObject({
      text: 'pending',
      deliveryStatus: '__emdash_delivered_pending_emit__',
    });
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toEqual([]);

    await chatTimelineStore.emitItem(conversation, item);

    const committedRows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-1'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(committedRows[0]?.payload ?? '{}')).toEqual({ text: 'pending' });
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toMatchObject([{ id: 'message-1', kind: 'user_message', text: 'pending' }]);
  });

  it('discards undelivered pending user messages during runtime recovery', async () => {
    const conversation = makeConversation();
    await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'pending',
      },
      { emit: false }
    );

    await chatTimelineStore.recoverPendingUserMessages(conversation);

    const rows = fixture.sqlite
      .prepare(`SELECT id FROM conversation_timeline_items WHERE id = 'message-1'`)
      .all();
    expect(rows).toEqual([]);
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toEqual([]);
  });

  it('recovers delivered user messages that were not emitted before restart', async () => {
    const conversation = makeConversation();
    const item = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'delivered',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageDeliveryStarted(conversation, item);
    await chatTimelineStore.markUserMessageDelivered(conversation, item);

    await chatTimelineStore.recoverPendingUserMessages(conversation);

    const rows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-1'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toEqual({ text: 'delivered' });
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toMatchObject([{ id: 'message-1', kind: 'user_message', text: 'delivered' }]);
  });

  it('deletes cancelled delivery-started user messages during runtime recovery', async () => {
    const conversation = makeConversation();
    const item = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'cancelled',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageDeliveryStarted(conversation, item);
    await chatTimelineStore.markUserMessageCancelled(conversation, item);

    await chatTimelineStore.recoverPendingUserMessages(conversation);

    const rows = fixture.sqlite
      .prepare(`SELECT id FROM conversation_timeline_items WHERE id = 'message-1'`)
      .all();
    expect(rows).toEqual([]);
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toEqual([]);
  });

  it('marks cancelled delivery-started user messages delivered when backend acceptance wins late', async () => {
    const conversation = makeConversation();
    const item = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'cancelled',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageDeliveryStarted(conversation, item);
    await chatTimelineStore.markUserMessageCancelled(conversation, item);

    await chatTimelineStore.markUserMessageDelivered(conversation, item);
    await chatTimelineStore.emitItem(conversation, item);

    const rows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-1'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toEqual({
      text: 'cancelled',
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:timeline' }),
      expect.objectContaining({
        item: expect.objectContaining({ id: 'message-1' }),
      })
    );
  });

  it('does not reveal cancelled pending user messages', async () => {
    const conversation = makeConversation();
    const item = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'cancelled',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageCancelled(conversation, item);

    await chatTimelineStore.emitItem(conversation, item);

    const rows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-1'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({
      text: 'cancelled',
      deliveryStatus: '__emdash_cancelled_delivery__',
    });
    expect(mocks.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation:timeline' }),
      expect.objectContaining({
        item: expect.objectContaining({ id: 'message-1' }),
      })
    );
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toEqual([]);
  });

  it('does not mark already delivered or revealed user messages cancelled', async () => {
    const conversation = makeConversation();
    const deliveredItem = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-delivered',
        text: 'delivered',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageDeliveryStarted(conversation, deliveredItem);
    await chatTimelineStore.markUserMessageDelivered(conversation, deliveredItem);

    await chatTimelineStore.markUserMessageCancelled(conversation, deliveredItem);

    let rows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-delivered'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({
      text: 'delivered',
      deliveryStatus: '__emdash_delivered_pending_emit__',
    });

    const revealedItem = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-revealed',
        text: 'revealed',
      },
      { emit: false }
    );
    await chatTimelineStore.emitItem(conversation, revealedItem);

    await chatTimelineStore.markUserMessageCancelled(conversation, revealedItem);

    rows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-revealed'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toEqual({ text: 'revealed' });
    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'message-revealed', text: 'revealed' }),
      ])
    );
  });

  it('does not delete already delivered or revealed user messages', async () => {
    const conversation = makeConversation();
    const deliveredItem = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-delivered',
        text: 'delivered',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageDeliveryStarted(conversation, deliveredItem);
    await chatTimelineStore.markUserMessageDelivered(conversation, deliveredItem);

    await chatTimelineStore.deleteItem(conversation, deliveredItem.id);

    let rows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-delivered'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({
      text: 'delivered',
      deliveryStatus: '__emdash_delivered_pending_emit__',
    });

    const revealedItem = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-revealed',
        text: 'revealed',
      },
      { emit: false }
    );
    await chatTimelineStore.emitItem(conversation, revealedItem);

    await chatTimelineStore.deleteItem(conversation, revealedItem.id);

    rows = fixture.sqlite
      .prepare(`SELECT payload FROM conversation_timeline_items WHERE id = 'message-revealed'`)
      .all() as Array<{ payload: string }>;
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toEqual({ text: 'revealed' });
  });

  it('does not cancel delivery-started rows from other conversations', async () => {
    await seedSecondChatConversation(fixture);
    const conversation = makeConversation();
    const otherConversation = makeConversation({
      id: 'conversation-2',
      title: 'Conversation 2',
    });
    const item = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'cancelled',
      },
      { emit: false }
    );
    const otherItem = await chatTimelineStore.appendUserMessage(
      otherConversation,
      {
        messageId: 'message-2',
        text: 'other',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageDeliveryStarted(conversation, item);
    await chatTimelineStore.markUserMessageDeliveryStarted(otherConversation, otherItem);

    await chatTimelineStore.markUserMessageCancelled(conversation, item);

    const rows = fixture.sqlite
      .prepare(
        `SELECT id, conversation_id AS conversationId, payload
         FROM conversation_timeline_items
         WHERE id IN ('message-1', 'message-2')
         ORDER BY id`
      )
      .all() as Array<{ id: string; conversationId: string; payload: string }>;
    expect(rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }))).toEqual([
      {
        id: 'message-1',
        conversationId: 'conversation-1',
        payload: {
          text: 'cancelled',
          deliveryStatus: '__emdash_cancelled_delivery__',
        },
      },
      {
        id: 'message-2',
        conversationId: 'conversation-2',
        payload: {
          text: 'other',
          deliveryStatus: '__emdash_delivery_started__',
        },
      },
    ]);
  });

  it('does not delete silent rows from other conversations', async () => {
    await seedSecondChatConversation(fixture);
    const conversation = makeConversation();
    const otherConversation = makeConversation({
      id: 'conversation-2',
      title: 'Conversation 2',
    });
    const item = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'deleted',
      },
      { emit: false }
    );
    const otherItem = await chatTimelineStore.appendUserMessage(
      otherConversation,
      {
        messageId: 'message-2',
        text: 'other',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageDeliveryStarted(conversation, item);
    await chatTimelineStore.markUserMessageDeliveryStarted(otherConversation, otherItem);

    await chatTimelineStore.deleteItem(conversation, item.id);

    const rows = fixture.sqlite
      .prepare(
        `SELECT id, conversation_id AS conversationId, payload
         FROM conversation_timeline_items
         WHERE id IN ('message-1', 'message-2')
         ORDER BY id`
      )
      .all() as Array<{ id: string; conversationId: string; payload: string }>;
    expect(rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }))).toEqual([
      {
        id: 'message-2',
        conversationId: 'conversation-2',
        payload: {
          text: 'other',
          deliveryStatus: '__emdash_delivery_started__',
        },
      },
    ]);
  });

  it('recovers delivery-started user messages with an uncertainty error', async () => {
    const conversation = makeConversation();
    const item = await chatTimelineStore.appendUserMessage(
      conversation,
      {
        messageId: 'message-1',
        text: 'maybe sent',
      },
      { emit: false }
    );
    await chatTimelineStore.markUserMessageDeliveryStarted(conversation, item);

    await chatTimelineStore.recoverPendingUserMessages(conversation);
    await chatTimelineStore.recoverPendingUserMessages(conversation);

    const items = await chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1');
    expect(items).toMatchObject([
      { id: 'message-1', kind: 'user_message', text: 'maybe sent' },
      {
        kind: 'error',
        message:
          'Emdash restarted before it could confirm whether this message reached the agent backend.',
      },
    ]);
  });

  it('lists the latest timeline tail by default', async () => {
    const conversation = makeConversation();
    for (let index = 1; index <= 105; index++) {
      await chatTimelineStore.append(conversation, {
        id: `message-${index}`,
        kind: 'user_message',
        payload: { text: `message ${index}` },
      });
    }

    const items = await chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1');

    expect(items).toHaveLength(100);
    expect(items[0]?.id).toBe('message-6');
    expect(items.at(-1)?.id).toBe('message-105');
  });

  it('does not count silently appended user messages against timeline limits', async () => {
    const conversation = makeConversation();
    await chatTimelineStore.append(conversation, {
      id: 'message-1',
      kind: 'user_message',
      payload: { text: 'visible 1' },
    });
    await chatTimelineStore.append(conversation, {
      id: 'message-2',
      kind: 'user_message',
      payload: { text: 'visible 2' },
    });
    await chatTimelineStore.appendUserMessage(
      conversation,
      { messageId: 'message-pending', text: 'pending' },
      { emit: false }
    );
    await chatTimelineStore.append(conversation, {
      id: 'message-4',
      kind: 'assistant_message',
      payload: { text: 'visible 4' },
    });

    const items = await chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1', {
      limit: 2,
    });

    expect(items.map((item) => item.id)).toEqual(['message-2', 'message-4']);
  });

  it('rejects terminal conversations at the chat timeline boundary', async () => {
    await fixture.db.insert(conversations).values({
      id: 'conversation-terminal',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Terminal conversation',
      provider: 'codex',
      runtimeMode: 'terminal',
    });

    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-terminal')
    ).rejects.toThrow('Conversation does not use chat runtime');
    await expect(
      chatTimelineStore.append(
        makeConversation({ id: 'conversation-terminal', runtimeMode: 'terminal' }),
        {
          kind: 'user_message',
          payload: { text: 'should fail' },
        }
      )
    ).rejects.toThrow('Conversation does not use chat runtime');
  });

  it('rejects invalid persisted payloads during timeline replay', async () => {
    fixture.sqlite
      .prepare(
        `INSERT INTO conversation_timeline_items (id, conversation_id, sequence, kind, payload)
         VALUES ('message-invalid', 'conversation-1', 1, 'assistant_message', '{"message":"wrong field"}')`
      )
      .run();

    await expect(
      chatTimelineStore.listTimeline('project-1', 'task-1', 'conversation-1')
    ).rejects.toThrow('Invalid conversation timeline payload');
  });

  it('validates timeline payloads before inserting rows', async () => {
    await expect(
      chatTimelineStore.append(makeConversation(), {
        kind: 'assistant_message',
        payload: { message: 'wrong field' },
      } as unknown as AppendConversationTimelineItemInput)
    ).rejects.toThrow('Invalid conversation timeline payload');

    const row = fixture.sqlite
      .prepare(`SELECT COUNT(*) AS count FROM conversation_timeline_items`)
      .get() as { count: number };
    expect(row.count).toBe(0);
  });
});

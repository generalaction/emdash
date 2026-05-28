import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversations } from '@main/db/schema';
import type { Conversation } from '@shared/conversations';
import { ChatConversationRuntime } from './chat-conversation-runtime';

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

  afterEach(() => {
    runtime.dehydrateConversation('conversation-1');
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
});

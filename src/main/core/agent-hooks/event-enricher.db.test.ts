import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversations } from '@main/db/schema';
import { enrichEvent } from './event-enricher';

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return mocks.db ?? {};
  },
}));

async function seedConversation(fixture: Awaited<ReturnType<typeof openFixture>>) {
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

describe('enrichEvent', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    await seedConversation(fixture);
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('uses raw Codex hook stdin as the last assistant message', async () => {
    const event = await enrichEvent({
      ptyId: 'codex-conv-conversation-1',
      type: 'notification',
      body: 'done',
    });

    expect(event.payload.lastAssistantMessage).toBe('done');
  });

  it('preserves structured hook payloads', async () => {
    const event = await enrichEvent({
      ptyId: 'codex-conv-conversation-1',
      type: 'notification',
      body: JSON.stringify({
        notification_type: 'idle_prompt',
        last_assistant_message: 'done',
      }),
    });

    expect(event.payload.notificationType).toBe('idle_prompt');
    expect(event.payload.lastAssistantMessage).toBe('done');
  });
});

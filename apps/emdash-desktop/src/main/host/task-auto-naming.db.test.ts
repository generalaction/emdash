import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '@core/features/conversations/node/createConversation';
import { nameTaskFromConversation } from '@core/features/tasks/node/operations/nameTaskFromConversation';
import { renameTask } from '@core/features/tasks/node/operations/renameTask';
import { updateLinkedIssue } from '@core/features/tasks/node/operations/updateLinkedIssue';
import { tasks } from '@core/services/app-db/node/schema';

describe('nameTaskFromConversation', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    fixture.sqlite.prepare(`INSERT INTO projects (id, name) VALUES ('project-1', 'Project')`).run();
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: 'project-1',
      name: 'shaggy-canyons-appear',
      status: 'in_progress',
      autoNameConversationId: 'conversation-1',
      workspaceId: 'workspace-1',
      taskBranch: 'emdash/shaggy-canyons-appear',
    });
  });

  afterEach(() => fixture.close());

  function row() {
    return fixture.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get()!;
  }

  function addConversation(id: string, beforeHostAck?: () => Promise<unknown>) {
    return createConversation(
      {
        id,
        projectId: 'project-1',
        taskId: 'task-1',
        provider: 'claude',
        title: 'Conversation',
        type: 'acp',
      },
      {
        db: fixture.db,
        telemetry: { capture: () => {} },
        taskSessions: { getTask: () => undefined } as never,
        withCompensation: async ({ action }) => action(),
        runtimes: {
          client: async () =>
            ok({
              conversations: {
                create: async () => {
                  await beforeHostAck?.();
                  return ok(undefined);
                },
                delete: async () => ok(undefined),
              },
            }),
        } as never,
        hostIsReachable: () => true,
        workspaceIdentity: {
          resolve: async () => ({ host: LOCAL_HOST_REF, path: '/tmp/workspace' }),
        },
      }
    );
  }

  it('associates delayed naming with only the first conversation created later', async () => {
    await fixture.db
      .update(tasks)
      .set({ autoNameConversationId: '' })
      .where(eq(tasks.id, 'task-1'));
    await addConversation('later-first');
    await addConversation('later-second');
    await nameTaskFromConversation(fixture.db, 'later-second', 'Other work');
    expect(row().name).toBe('shaggy-canyons-appear');
    await nameTaskFromConversation(fixture.db, 'later-first', 'Fix login timeout');
    expect(row().name).toBe('fix-login-timeout');
  });

  it('preserves a manual name changed while the first host conversation is registering', async () => {
    await fixture.db
      .update(tasks)
      .set({ autoNameConversationId: '' })
      .where(eq(tasks.id, 'task-1'));
    await addConversation('later-first', () =>
      renameTask(fixture.db, 'project-1', 'task-1', 'my-task-name')
    );
    await nameTaskFromConversation(fixture.db, 'later-first', 'Fix login timeout');
    expect(row()).toMatchObject({ name: 'my-task-name', autoNameConversationId: null });
  });

  it('rolls back the conversation row if associating its naming marker fails', async () => {
    await fixture.db
      .update(tasks)
      .set({ autoNameConversationId: '' })
      .where(eq(tasks.id, 'task-1'));
    fixture.sqlite.exec(`
      CREATE TRIGGER reject_name_binding BEFORE UPDATE OF auto_name_conversation_id ON tasks
      WHEN NEW.auto_name_conversation_id <> ''
      BEGIN SELECT RAISE(ABORT, 'fixture binding failure'); END;
    `);
    await expect(addConversation('failed-first')).rejects.toThrow();
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM conversations').get()).toEqual({
      n: 0,
    });
    expect(row().autoNameConversationId).toBe('');
    fixture.sqlite.exec('DROP TRIGGER reject_name_binding');
    await addConversation('successful-first');
    expect(row().autoNameConversationId).toBe('successful-first');
  });

  it('serializes first-conversation creation and releases the next request after failure', async () => {
    await fixture.db
      .update(tasks)
      .set({ autoNameConversationId: '' })
      .where(eq(tasks.id, 'task-1'));
    const events: string[] = [];
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = addConversation('failed-first', async () => {
      events.push('first-started');
      await blocked;
      events.push('first-failed');
      throw new Error('fixture host failure');
    }).catch(() => undefined);
    await vi.waitFor(() => expect(events).toEqual(['first-started']));
    const second = addConversation('successful-first', async () => {
      events.push('second-started');
    });
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-started', 'first-failed', 'second-started']);
    expect(row().autoNameConversationId).toBe('successful-first');
  });

  it('does not treat an empty conversation identity as permission to name unbound tasks', async () => {
    await fixture.db
      .update(tasks)
      .set({ autoNameConversationId: '' })
      .where(eq(tasks.id, 'task-1'));
    await nameTaskFromConversation(fixture.db, '', 'Fix login timeout');
    expect(row().name).toBe('shaggy-canyons-appear');
  });

  it('names the task from the first five title words without changing workspace identity', async () => {
    const named = await nameTaskFromConversation(
      fixture.db,
      'conversation-1',
      'Fix the login timeout after sleep'
    );

    expect(named?.name).toBe('fix-the-login-timeout-after');
    expect(row()).toMatchObject({
      autoNameConversationId: null,
      workspaceId: 'workspace-1',
      taskBranch: 'emdash/shaggy-canyons-appear',
    });
  });

  it('ignores later title updates after the first name', async () => {
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Fix login timeout');
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Add billing settings');

    expect(row().name).toBe('fix-login-timeout');
  });

  it('ignores a sibling conversation', async () => {
    await nameTaskFromConversation(fixture.db, 'conversation-2', 'Fix login timeout');

    expect(row().name).toBe('shaggy-canyons-appear');
  });

  it('preserves a manual rename when an agent responds late', async () => {
    await renameTask(fixture.db, 'project-1', 'task-1', 'my-task-name');
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Fix login timeout');

    expect(row()).toMatchObject({ name: 'my-task-name', autoNameConversationId: null });
  });

  it('preserves a task created without naming eligibility', async () => {
    await fixture.db
      .update(tasks)
      .set({ name: 'custom-name', autoNameConversationId: null })
      .where(eq(tasks.id, 'task-1'));
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Fix login timeout');

    expect(row().name).toBe('custom-name');
  });

  it('cancels naming when an issue is linked before the response', async () => {
    await updateLinkedIssue(
      fixture.db,
      'task-1',
      {
        provider: 'github',
        identifier: '42',
        title: 'Issue title',
        url: 'https://github.com/example/project/issues/42',
      },
      { capture: () => {} }
    );
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Fix login timeout');

    expect(row()).toMatchObject({
      name: 'shaggy-canyons-appear',
      autoNameConversationId: null,
    });
  });

  it.each([
    { archivedAt: '2026-09-30 00:00:00' },
    { deletedAt: '2026-09-30 00:00:00' },
    { type: 'automation-run' },
  ])('ignores inactive or automation tasks: %j', async (values) => {
    await fixture.db.update(tasks).set(values).where(eq(tasks.id, 'task-1'));
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Fix login timeout');

    expect(row().name).toBe('shaggy-canyons-appear');
  });

  it('retains the placeholder and consumes eligibility when the name already exists', async () => {
    await fixture.db.insert(tasks).values({
      id: 'task-2',
      projectId: 'project-1',
      name: 'Fix-Login-Timeout',
      status: 'in_progress',
    });
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Fix login timeout');
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Different work');

    expect(row()).toMatchObject({
      name: 'shaggy-canyons-appear',
      autoNameConversationId: null,
    });
  });

  it.each(['', '   ', '!!!'])('retains the placeholder for an unusable title %j', async (title) => {
    await nameTaskFromConversation(fixture.db, 'conversation-1', title);

    expect(row().name).toBe('shaggy-canyons-appear');
  });

  it('limits hyphenated title words and the existing name length', async () => {
    await nameTaskFromConversation(
      fixture.db,
      'conversation-1',
      `Fix-${'a'.repeat(80)}-three-four-five-six`
    );

    expect(row().name).toHaveLength(64);
    expect(row().name.split('-').length).toBeLessThanOrEqual(5);
  });

  it('honors the capitalization preference', async () => {
    await nameTaskFromConversation(fixture.db, 'conversation-1', 'Fix ACP Startup', true);

    expect(row().name).toBe('Fix-ACP-Startup');
  });
});

import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { tasks } from '@core/services/app-db/node/schema';
import { updateLinkedIssue } from './updateLinkedIssue';

describe('Jira sync guarded linked issue refresh', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  const issue: LinkedIssue = {
    provider: 'jira',
    identifier: 'ENG-1',
    title: 'Updated',
    url: 'https://example.atlassian.net/browse/ENG-1',
    description: 'New description',
    context: 'New comments',
  };
  const telemetry = { capture: vi.fn() };
  beforeEach(async () => {
    fixture = await openFixture('empty');
    fixture.sqlite.exec(
      "INSERT INTO projects (id, name) VALUES ('p1', 'Project'); INSERT INTO tasks (id, project_id, name, status) VALUES ('t1', 'p1', 'Original name', 'todo');"
    );
    telemetry.capture.mockClear();
  });
  afterEach(() => fixture.close());

  it('updates the existing snapshot without changing task name or lifecycle', async () => {
    expect(await updateLinkedIssue(fixture.db, 't1', issue, telemetry, true)).toMatchObject({
      name: 'Original name',
      status: 'todo',
      linkedIssue: issue,
    });
  });

  it.each([null, 'working', 'completed', 'idle'])(
    'refuses a task with a conversation whose status is %s',
    async (status) => {
      fixture.sqlite
        .prepare(
          "INSERT INTO conversations (id, task_id, project_id, title, provider, agent_status) VALUES ('c1', 't1', 'p1', 'Agent', 'claude', ?)"
        )
        .run(status);
      expect(await updateLinkedIssue(fixture.db, 't1', issue, telemetry, true)).toBeUndefined();
      expect(
        fixture.db.select().from(tasks).where(eq(tasks.id, 't1')).get()?.linkedIssue
      ).toBeNull();
      expect(telemetry.capture).not.toHaveBeenCalled();
    }
  );

  it('does not update archived tasks', async () => {
    await fixture.db.update(tasks).set({ archivedAt: '2026-01-01' }).where(eq(tasks.id, 't1'));
    expect(await updateLinkedIssue(fixture.db, 't1', issue, telemetry, true)).toBeUndefined();
  });
});

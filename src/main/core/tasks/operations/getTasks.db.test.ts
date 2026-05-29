import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import { getTasks } from './getTasks';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

describe('getTasks', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    mocks.db = fixture.db;

    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, created_at, updated_at)
         VALUES ('project-1', 'Project', '/repo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run();
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('loads tasks whose source_branch is a historical raw branch string', async () => {
    fixture.sqlite
      .prepare(
        `INSERT INTO tasks (
           id,
           project_id,
           name,
           status,
           source_branch,
           task_branch,
           created_at,
           updated_at,
           status_changed_at
         )
         VALUES (
           'task-1',
           'project-1',
           'Raw Branch Task',
           'in_progress',
           'main',
           'feature/raw-branch',
           CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP
         )`
      )
      .run();

    const rows = await getTasks('project-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceBranch).toEqual({ type: 'local', branch: 'main' });
  });
});

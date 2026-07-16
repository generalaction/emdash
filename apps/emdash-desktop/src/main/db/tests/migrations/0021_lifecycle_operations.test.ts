import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';
import { lifecycleOperations, projects, tasks, workspaces } from '@main/db/schema';

describe('0021_lifecycle_operations', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('adds durable lifecycle operations and tombstones without hiding existing rows', async () => {
    fixture = await openFixture('pre-0020');

    const table = fixture.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='lifecycle_operations'`)
      .all() as { name: string }[];
    expect(table).toHaveLength(1);

    const indexes = fixture.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lifecycle_operations'`
      )
      .all() as { name: string }[];
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'idx_lifecycle_operations_status',
        'idx_lifecycle_operations_host_status',
        'idx_lifecycle_operations_entity_key',
      ])
    );

    const [project] = await fixture.db.select().from(projects).limit(1);
    const [task] = await fixture.db.select().from(tasks).limit(1);
    const [workspace] = await fixture.db.select().from(workspaces).limit(1);
    expect(project?.deletedAt).toBeNull();
    expect(task?.deletedAt).toBeNull();
    if (workspace) expect(workspace.deletedAt).toBeNull();

    await fixture.db.insert(lifecycleOperations).values({
      id: 'operation-1',
      kind: 'delete-task',
      status: 'pending',
      projectId: project?.id,
      taskId: task?.id,
      workspaceId: workspace?.id,
      entityKey: task?.id,
      hostRef: 'local',
      payload: {
        version: '1',
        source: 'user',
        entityName: task?.name,
      },
      createdAt: Date.now(),
    });

    const [operation] = await fixture.db.select().from(lifecycleOperations);
    expect(operation).toMatchObject({
      id: 'operation-1',
      kind: 'delete-task',
      status: 'pending',
      hostRef: 'local',
      entityKey: task?.id,
      payload: {
        version: '1',
        source: 'user',
        entityName: task?.name,
      },
      attempt: 0,
    });
  });
});

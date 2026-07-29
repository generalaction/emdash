import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  lifecycleOperations,
  operationClaims,
  projects,
  tasks,
} from '@core/services/app-db/node/schema';

describe('0025_operation_hierarchy_claims', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('adds operation parent metadata and claim rows', async () => {
    fixture = await openFixture('pre-0024');

    const columns = fixture.sqlite.prepare(`PRAGMA table_info(lifecycle_operations)`).all() as {
      name: string;
    }[];
    expect(columns.map((row) => row.name)).toEqual(
      expect.arrayContaining(['parent_operation_id', 'initiated_by'])
    );

    const claimsTable = fixture.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='operation_claims'`)
      .all() as { name: string }[];
    expect(claimsTable).toHaveLength(1);

    const claimIndexes = fixture.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='operation_claims'`)
      .all() as { name: string }[];
    expect(claimIndexes.map((row) => row.name)).toEqual(
      expect.arrayContaining(['idx_operation_claims_resource'])
    );

    const lifecycleIndexes = fixture.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lifecycle_operations'`
      )
      .all() as { name: string }[];
    expect(lifecycleIndexes.map((row) => row.name)).toEqual(
      expect.arrayContaining(['idx_lifecycle_operations_parent_status'])
    );

    const [project] = await fixture.db.select().from(projects).limit(1);
    const [task] = await fixture.db.select().from(tasks).limit(1);
    expect(project).toBeDefined();
    expect(task).toBeDefined();

    await fixture.db.insert(lifecycleOperations).values([
      {
        id: 'operation-parent',
        kind: 'delete-project',
        status: 'pending',
        projectId: project!.id,
        entityKey: project!.id,
        hostRef: 'local',
        payload: { version: '1', source: 'user', entityName: project!.name },
        createdAt: Date.now(),
      },
      {
        id: 'operation-child',
        kind: 'delete-task',
        status: 'pending',
        projectId: project!.id,
        taskId: task!.id,
        entityKey: task!.id,
        parentOperationId: 'operation-parent',
        hostRef: 'local',
        payload: { version: '1', source: 'user', entityName: task!.name },
        createdAt: Date.now(),
      },
    ]);
    await fixture.db.insert(operationClaims).values({
      operationId: 'operation-child',
      resourceKey: `task:${task!.id}`,
    });

    const [child] = await fixture.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.id, 'operation-child'));
    expect(child.parentOperationId).toBe('operation-parent');

    const [claim] = await fixture.db.select().from(operationClaims);
    expect(claim).toEqual({
      operationId: 'operation-child',
      resourceKey: `task:${task!.id}`,
    });
  });
});

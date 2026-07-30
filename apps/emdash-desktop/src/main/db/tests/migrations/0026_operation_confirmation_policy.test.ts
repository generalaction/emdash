import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { lifecycleOperations, projects } from '@core/services/app-db/node/schema';

describe('0026_operation_confirmation_policy', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('adds operation confirmation columns and parent forget policy', async () => {
    fixture = await openFixture('pre-0024');

    const columns = fixture.sqlite.prepare(`PRAGMA table_info(lifecycle_operations)`).all() as {
      name: string;
    }[];
    expect(columns.map((row) => row.name)).toEqual(
      expect.arrayContaining(['parent_forget_policy', 'confirmed_at', 'confirmation_reason'])
    );

    const [project] = await fixture.db.select().from(projects).limit(1);
    expect(project).toBeDefined();

    await fixture.db.insert(lifecycleOperations).values({
      id: 'operation-confirmation-policy',
      kind: 'delete-project',
      status: 'awaiting-confirmation',
      projectId: project!.id,
      entityKey: project!.id,
      parentForgetPolicy: 'orphan-children',
      hostRef: 'local',
      payload: { version: '2', source: 'user', entityName: project!.name },
      confirmedAt: 1_000,
      confirmationReason: 'workspace-modified',
      createdAt: Date.now(),
    });

    const [operation] = await fixture.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.id, 'operation-confirmation-policy'));
    expect(operation).toMatchObject({
      parentForgetPolicy: 'orphan-children',
      confirmedAt: 1_000,
      confirmationReason: 'workspace-modified',
    });
  });
});

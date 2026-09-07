import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { AutomationRun, AutomationRunStatus } from '@emdash/core/runtimes/automations/api';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getRunProjectionsByRunIds,
  upsertRunProjection,
} from '@core/features/automations/api/node/run-projection';
import { automationRuns, automations } from '@core/services/app-db/node/schema';
import { deleteAutomationDefinition } from './repo';

function runFixture({
  id = 'run-1',
  automationId = 'automation-1',
  automationName = 'Review changes',
  status = 'scheduled',
  seq = 1,
  scheduledAt = 100,
  startedAt = null,
  finishedAt = null,
}: {
  id?: string;
  automationId?: string;
  automationName?: string;
  status?: AutomationRunStatus;
  seq?: number;
  scheduledAt?: number | null;
  startedAt?: number | null;
  finishedAt?: number | null;
} = {}): AutomationRun {
  return {
    id,
    seq,
    automationId,
    status,
    triggerKind: 'manual',
    configSnapshot: {
      name: automationName,
      schedule: { expr: '0 9 * * *', tz: 'UTC' },
      agent: {
        type: 'acp',
        start: {
          providerId: 'claude',
          model: null,
          initialQueue: [{ text: 'Review changes' }],
        },
      },
      workspace: {
        kind: 'worktree',
        repository: {
          host: LOCAL_HOST_REF,
          path: { root: { kind: 'posix' }, segments: ['repo'] },
        },
        worktreePoolPath: {
          root: { kind: 'posix' },
          segments: ['worktrees', 'repo-12345678'],
        },
        baseRemote: 'origin',
        preservePatterns: [],
        git: {
          kind: 'create-branch',
          fromBranch: { type: 'local', branch: 'main' },
          pushRemote: null,
        },
      },
    },
    generatedName: automationName,
    scheduledAt,
    deadlineAt: null,
    startedAt,
    finishedAt,
    workspace: null,
    branchName: null,
    conversationId: null,
    sessionId: null,
    error: null,
  };
}

describe('automation run projection', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  it('inserts a projection using the snapshotted automation name', async () => {
    await upsertRunProjection(fixture.db, runFixture());

    await expect(fixture.db.select().from(automationRuns)).resolves.toEqual([
      {
        id: 'run-1',
        automationId: 'automation-1',
        automationName: 'Review changes',
        status: 'scheduled',
        scheduledAt: 100,
        startedAt: null,
        finishedAt: null,
        seq: 1,
      },
    ]);
  });

  it('only updates a projection when the incoming sequence is newer', async () => {
    await upsertRunProjection(
      fixture.db,
      runFixture({
        automationName: 'Current name',
        status: 'done',
        seq: 3,
        startedAt: 110,
        finishedAt: 120,
      })
    );
    await upsertRunProjection(
      fixture.db,
      runFixture({ automationName: 'Stale name', status: 'failed', seq: 2, finishedAt: 115 })
    );
    await upsertRunProjection(
      fixture.db,
      runFixture({ automationName: 'Equal name', status: 'cancelled', seq: 3, finishedAt: 116 })
    );

    const [unchanged] = await fixture.db.select().from(automationRuns);
    expect(unchanged).toMatchObject({
      automationName: 'Current name',
      status: 'done',
      startedAt: 110,
      finishedAt: 120,
      seq: 3,
    });

    await upsertRunProjection(
      fixture.db,
      runFixture({
        automationName: 'Updated name',
        status: 'failed',
        seq: 4,
        startedAt: 110,
        finishedAt: 130,
      })
    );

    const [updated] = await fixture.db.select().from(automationRuns);
    expect(updated).toMatchObject({
      automationName: 'Updated name',
      status: 'failed',
      startedAt: 110,
      finishedAt: 130,
      seq: 4,
    });
  });

  it('batch-loads projections by run id', async () => {
    await upsertRunProjection(fixture.db, runFixture({ id: 'run-1' }));
    await upsertRunProjection(fixture.db, runFixture({ id: 'run-2', seq: 2 }));
    await upsertRunProjection(fixture.db, runFixture({ id: 'run-3', seq: 3 }));

    const rows = await getRunProjectionsByRunIds(fixture.db, [
      'run-3',
      'missing',
      'run-1',
      'run-1',
    ]);

    expect(rows.map((row) => row.id).sort()).toEqual(['run-1', 'run-3']);
    await expect(getRunProjectionsByRunIds(fixture.db, [])).resolves.toEqual([]);
  });

  it('preserves projections when their automation definition is deleted', async () => {
    await fixture.db.insert(automations).values({
      id: 'automation-1',
      name: 'Review changes',
      createdAt: 100,
      updatedAt: 100,
    });
    await upsertRunProjection(fixture.db, runFixture());

    await expect(deleteAutomationDefinition(fixture.db, 'automation-1')).resolves.toBe(true);

    const [definition] = await fixture.db
      .select()
      .from(automations)
      .where(eq(automations.id, 'automation-1'));
    expect(definition?.deletedAt).not.toBeNull();
    await expect(fixture.db.select().from(automationRuns)).resolves.toHaveLength(1);
  });
});

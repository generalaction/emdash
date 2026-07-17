import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { AutomationRun, AutomationRunStatus } from '@emdash/core/runtimes/automations/api';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import { automationRuns, automations } from '@main/db/schema';
import { deleteAutomationDefinition } from './repo';
import { getRunProjectionsByRunIds, upsertRunProjection } from './run-projection';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

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
    mocks.db = fixture.db;
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('inserts a projection using the snapshotted automation name', async () => {
    await upsertRunProjection(runFixture());

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
      runFixture({
        automationName: 'Current name',
        status: 'done',
        seq: 3,
        startedAt: 110,
        finishedAt: 120,
      })
    );
    await upsertRunProjection(
      runFixture({ automationName: 'Stale name', status: 'failed', seq: 2, finishedAt: 115 })
    );
    await upsertRunProjection(
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
    await upsertRunProjection(runFixture({ id: 'run-1' }));
    await upsertRunProjection(runFixture({ id: 'run-2', seq: 2 }));
    await upsertRunProjection(runFixture({ id: 'run-3', seq: 3 }));

    const rows = await getRunProjectionsByRunIds(['run-3', 'missing', 'run-1', 'run-1']);

    expect(rows.map((row) => row.id).sort()).toEqual(['run-1', 'run-3']);
    await expect(getRunProjectionsByRunIds([])).resolves.toEqual([]);
  });

  it('preserves projections when their automation definition is deleted', async () => {
    await fixture.db.insert(automations).values({
      id: 'automation-1',
      name: 'Review changes',
      createdAt: 100,
      updatedAt: 100,
    });
    await upsertRunProjection(runFixture());

    await expect(deleteAutomationDefinition('automation-1')).resolves.toBe(true);

    const [definition] = await fixture.db
      .select()
      .from(automations)
      .where(eq(automations.id, 'automation-1'));
    expect(definition?.deletedAt).not.toBeNull();
    await expect(fixture.db.select().from(automationRuns)).resolves.toHaveLength(1);
  });
});

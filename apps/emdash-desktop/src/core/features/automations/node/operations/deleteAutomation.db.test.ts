import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import type { Logger } from '@emdash/shared/logger';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAutomations } from '@core/features/automations/node/repo';
import { automationRuns, automations } from '@core/services/app-db/node/schema';
import {
  deleteAutomation,
  sweepAutomationDeletionTombstones,
  type AutomationDeletionDependencies,
} from './deleteAutomation';

type AutomationsClient = HostRuntimesClient['automations'];

/**
 * Automation deletion as a plain function (operation-log retirement spec §3): host
 * cleanup first — cancel active runs, remove the deployment — then the desktop rows
 * purge. An unreachable host never discards the intent (ADR 0006): the automation row
 * keeps its `deletedAt` tombstone and the sweep converges the host-artifact half once
 * the host is reachable again. Nothing submits to the operations kernel. Ported from
 * the retired delete-automation-definition tests.
 */
describe('deleteAutomation', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  async function seedAutomation(): Promise<void> {
    fixture.sqlite.prepare(`INSERT INTO projects (id, name) VALUES ('project-1', 'Project')`).run();
    await fixture.db.insert(automations).values({
      id: 'automation-1',
      name: 'Automation',
      projectId: 'project-1',
      createdAt: 1,
      updatedAt: 1,
    });
    await fixture.db.insert(automationRuns).values({
      id: 'run-1',
      automationId: 'automation-1',
      automationName: 'Automation',
      status: 'scheduled',
      seq: 1,
    });
  }

  function makeClient() {
    return {
      listRuns: vi.fn(async (input: { status: string }) => ({
        success: true as const,
        data: {
          runs: input.status === 'scheduled' ? [{ id: 'run-1', seq: 1 }] : [],
        },
      })),
      cancelRun: vi.fn(async (_input: { automationId: string; runId: string }) => ({
        success: true as const,
        data: undefined,
      })),
      remove: vi.fn(async (_input: { automationId: string }) => ({
        success: true as const,
        data: undefined,
      })),
    };
  }

  function makeDependencies(
    resolveClient: AutomationDeletionDependencies['resolveClient']
  ): AutomationDeletionDependencies {
    return {
      db: fixture.db,
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
      resolveClient,
    };
  }

  it('cancels active runs, removes the deployment, and purges the desktop rows', async () => {
    await seedAutomation();
    const client = makeClient();
    const dependencies = makeDependencies(async () => client as unknown as AutomationsClient);

    const result = await deleteAutomation(dependencies, 'automation-1');

    expect(result.success).toBe(true);
    expect(client.cancelRun).toHaveBeenCalledWith({ automationId: 'automation-1', runId: 'run-1' });
    expect(client.remove).toHaveBeenCalledWith({ automationId: 'automation-1' });
    expect(
      await fixture.db.select().from(automations).where(eq(automations.id, 'automation-1'))
    ).toHaveLength(0);
    expect(
      await fixture.db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.automationId, 'automation-1'))
    ).toHaveLength(0);
  });

  it('tombstones the deletion when the host is unreachable — intent survives, hidden from lists', async () => {
    await seedAutomation();
    const dependencies = makeDependencies(async () => {
      throw new Error('host unreachable');
    });

    const result = await deleteAutomation(dependencies, 'automation-1');

    expect(result.success).toBe(true);
    // The row stays as the durable tombstone (deletedAt set) instead of purging: the
    // deployment and its runs still exist host-side and must be cleaned up later.
    const [row] = await fixture.db
      .select()
      .from(automations)
      .where(eq(automations.id, 'automation-1'));
    expect(row?.deletedAt).not.toBeNull();
    // The caller-facing surface treats it as deleted already.
    expect(await listAutomations(fixture.db)).toHaveLength(0);
  });

  it('suppresses an offline delete double-fire: second call is a plain not-found', async () => {
    await seedAutomation();
    const dependencies = makeDependencies(async () => {
      throw new Error('host unreachable');
    });

    const first = await deleteAutomation(dependencies, 'automation-1');
    const second = await deleteAutomation(dependencies, 'automation-1');

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    if (!second.success) expect(second.error.type).toBe('automation-not-found');
  });

  it('sweep converges a tombstoned deletion once the host is reachable', async () => {
    await seedAutomation();
    const offline = makeDependencies(async () => {
      throw new Error('host unreachable');
    });
    await deleteAutomation(offline, 'automation-1');

    const client = makeClient();
    await sweepAutomationDeletionTombstones(
      makeDependencies(async () => client as unknown as AutomationsClient)
    );

    expect(client.cancelRun).toHaveBeenCalledWith({ automationId: 'automation-1', runId: 'run-1' });
    expect(client.remove).toHaveBeenCalledWith({ automationId: 'automation-1' });
    expect(
      await fixture.db.select().from(automations).where(eq(automations.id, 'automation-1'))
    ).toHaveLength(0);
    expect(
      await fixture.db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.automationId, 'automation-1'))
    ).toHaveLength(0);
  });

  it('sweep keeps the tombstone while the host stays unreachable', async () => {
    await seedAutomation();
    const offline = makeDependencies(async () => {
      throw new Error('host unreachable');
    });
    await deleteAutomation(offline, 'automation-1');

    await sweepAutomationDeletionTombstones(offline);

    const [row] = await fixture.db
      .select()
      .from(automations)
      .where(eq(automations.id, 'automation-1'));
    expect(row?.deletedAt).not.toBeNull();
  });

  it('surfaces a reachable-host cleanup failure and leaves the rows intact', async () => {
    await seedAutomation();
    const client = makeClient();
    client.remove.mockResolvedValueOnce({
      success: false,
      error: { type: 'remove-failed', message: 'deployment locked' },
    } as never);
    const dependencies = makeDependencies(async () => client as unknown as AutomationsClient);

    const result = await deleteAutomation(dependencies, 'automation-1');

    expect(result).toEqual({
      success: false,
      error: { type: 'runtime-unavailable', message: 'deployment locked' },
    });
    expect(
      await fixture.db.select().from(automations).where(eq(automations.id, 'automation-1'))
    ).toHaveLength(1);
  });

  it('tolerates an already-removed deployment (automation-not-found)', async () => {
    await seedAutomation();
    const client = makeClient();
    client.remove.mockResolvedValueOnce({
      success: false,
      error: { type: 'automation-not-found', message: 'gone' },
    } as never);
    const dependencies = makeDependencies(async () => client as unknown as AutomationsClient);

    const result = await deleteAutomation(dependencies, 'automation-1');

    expect(result.success).toBe(true);
    expect(
      await fixture.db.select().from(automations).where(eq(automations.id, 'automation-1'))
    ).toHaveLength(0);
  });

  it('returns automation-not-found for an unknown id', async () => {
    const dependencies = makeDependencies(async () => makeClient() as never);

    const result = await deleteAutomation(dependencies, 'missing');

    expect(result).toEqual({
      success: false,
      error: { type: 'automation-not-found', message: 'Automation missing was not found' },
    });
  });

  it('refuses while the project is being deleted', async () => {
    await seedAutomation();
    fixture.sqlite
      .prepare(`UPDATE projects SET deleted_at = '2026-01-01T00:00:00.000Z' WHERE id = 'project-1'`)
      .run();
    const dependencies = makeDependencies(async () => makeClient() as never);

    const result = await deleteAutomation(dependencies, 'automation-1');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('project-deleting');
    expect(
      await fixture.db.select().from(automations).where(eq(automations.id, 'automation-1'))
    ).toHaveLength(1);
  });
});

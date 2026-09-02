import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  workspaceRegistryContract,
  type WorkspaceRecord,
  type WorkspaceRecords,
} from '@emdash/core/runtimes/workspace-registry/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { ok } from '@emdash/shared';
import { createController } from '@emdash/wire/rpc';
import { cell, expose, type Cell } from '@emdash/wire/state';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { projects } from '@core/services/app-db/node/schema';
import { WorkspaceRegistryBackfillService } from './workspace-registry-backfill';
import { WorkspaceRegistrySyncService } from './workspace-registry-sync-service';

const CONFIG = {
  version: '2' as const,
  git: { kind: 'none' as const },
  workspace: { kind: 'new-worktree' as const },
};

function hostRecord(id: string, path: string): WorkspaceRecord {
  return {
    id,
    kind: 'repository',
    path,
    parentId: null,
    origin: 'registered',
    gitAdminName: null,
    observedStatus: 'present',
    creation: null,
    lastCreateOutcome: null,
    lifecycle: null,
    lastRemovalAttempt: null,
    git: null,
    lastActivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    lastObservedAt: 1,
    config: null,
    runtime: null,
  };
}

describe('WorkspaceRegistrySyncService identity invariant', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let hostRecords: Cell<WorkspaceRecords>;
  let recordsHost: ReturnType<typeof expose<typeof workspaceRegistryContract.records>>;
  let projectConfigHost: ReturnType<typeof expose<typeof workspaceRegistryContract.projectConfig>>;
  let wire: TestWire<typeof workspaceRegistryContract>;
  let service: WorkspaceRegistrySyncService;
  let onError: ReturnType<typeof vi.fn<(context: string, error: unknown) => void>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    hostRecords = cell<WorkspaceRecords>({}, { name: 'test-workspace-records' });
    recordsHost = expose(workspaceRegistryContract.records, { list: () => hostRecords });
    projectConfigHost = expose(workspaceRegistryContract.projectConfig, {
      current: () => cell({} as never),
    });
    const unused = () => {
      throw new Error('not exercised by the sync service');
    };
    wire = createTestWire(
      workspaceRegistryContract,
      createController(workspaceRegistryContract, {
        records: recordsHost,
        projectConfig: projectConfigHost,
        getProjectConfig: unused,
        refreshProjectConfig: unused,
        patchPersonalProjectConfig: unused,
        importLegacyLifecycleSettings: unused,
        createWorkspace: unused,
        createWorktree: unused,
        retryStep: unused,
        runScript: unused,
        activateWorkspace: unused,
        deactivateWorkspace: unused,
        deleteWorkspace: unused,
        deleteWorktree: unused,
        updateWorktree: unused,
        measureUsage: unused,
        refresh: unused,
      } as never)
    );
    onError = vi.fn();
    const broker = {
      client: async () => ({ success: true, data: { workspaceRegistry: wire.client } }),
    } as unknown as RuntimeBroker;
    service = new WorkspaceRegistrySyncService({ db: fixture.db, runtimes: broker, onError });
  });

  afterEach(async () => {
    service?.dispose();
    await recordsHost.dispose();
    await projectConfigHost.dispose();
    await wire.dispose();
    fixture.close();
  });

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  it('reports a conflict once, skips that record, and keeps the attachment syncing', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.recordCreationIntent({
      id: 'desktop-id',
      type: 'local',
      kind: 'repository',
      location: 'local',
      path: '/repo',
      config: CONFIG,
    });
    hostRecords.set({
      'host-id': hostRecord('host-id', '/repo'),
      other: hostRecord('other', '/other'),
    });

    await service.attachHost(LOCAL_HOST_REF);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      'workspace registry identity invariant',
      expect.objectContaining({
        incomingId: 'host-id',
        conflictingId: 'desktop-id',
        path: '/repo',
      })
    );
    expect(registry.getLive('host-id')).toBeUndefined();
    expect(registry.getLive('other')).toMatchObject({ path: '/other' });
    expect(registry.getLive('desktop-id')).toMatchObject({
      path: '/repo',
      observedStatus: 'missing',
    });

    hostRecords.set({
      'host-id': hostRecord('host-id', '/repo'),
      other: hostRecord('other', '/other'),
      later: hostRecord('later', '/later'),
    });
    await settle();
    expect(registry.getLive('later')).toMatchObject({ path: '/later' });
    expect(onError).toHaveBeenCalledTimes(1);

    await service.attachHost(LOCAL_HOST_REF);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps syncing after the backfill retains a legacy row the Host assigned elsewhere', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.recordCreationIntent({
      id: 'legacy-repo',
      type: 'local',
      kind: 'repository',
      location: 'local',
      path: '/repo',
      config: CONFIG,
    });
    registry.recordCreationIntent({
      id: 'canonical-repo',
      type: 'local',
      kind: 'repository',
      location: 'local',
      path: '/other',
      config: CONFIG,
    });
    fixture.db
      .insert(projects)
      .values([
        { id: 'project', name: 'project', repositoryWorkspaceId: 'legacy-repo' },
        { id: 'other-project', name: 'other-project', repositoryWorkspaceId: 'canonical-repo' },
      ])
      .run();
    // The Host already knows /repo as canonical-repo, so legacy-repo needs a translation
    // that its Project binding forbids; the backfill skips it and completes.
    const hostByPath = new Map([['/repo', hostRecord('canonical-repo', '/repo')]]);
    const createWorkspace = vi.fn(async (input: { workspaceId: string; path: string }) => {
      const record = hostByPath.get(input.path) ?? hostRecord(input.workspaceId, input.path);
      hostByPath.set(input.path, record);
      return ok(record);
    });
    const backfill = new WorkspaceRegistryBackfillService({
      db: fixture.db,
      runtimes: { client: async () => ok({ workspaceRegistry: { createWorkspace } }) } as never,
      onError,
    });
    await expect(backfill.backfillHost(LOCAL_HOST_REF)).resolves.toEqual({ status: 'complete' });
    expect(onError).toHaveBeenCalledWith(
      'workspace registry backfill skipped conflict (legacy-repo)',
      expect.anything()
    );
    onError.mockClear();

    hostRecords.set({ 'canonical-repo': hostRecord('canonical-repo', '/repo') });
    await service.attachHost(LOCAL_HOST_REF);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      'workspace registry identity invariant',
      expect.objectContaining({
        path: '/repo',
        incomingId: 'canonical-repo',
        conflictingId: 'legacy-repo',
      })
    );
    expect(registry.getLive('legacy-repo')).toMatchObject({
      path: '/repo',
      observedStatus: 'missing',
    });
    expect(registry.getLive('canonical-repo')).toMatchObject({ path: '/other' });
    expect(
      fixture.db
        .select()
        .from(projects)
        .all()
        .map((row) => row.repositoryWorkspaceId)
    ).toEqual(['legacy-repo', 'canonical-repo']);

    hostRecords.set({
      'canonical-repo': hostRecord('canonical-repo', '/repo'),
      later: hostRecord('later', '/later'),
    });
    await settle();
    expect(registry.getLive('later')).toMatchObject({ path: '/later' });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

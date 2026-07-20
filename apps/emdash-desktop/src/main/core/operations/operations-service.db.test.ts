import { err, ok } from '@emdash/shared';
import { ManualClock } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletionList } from '@core/primitives/operations/api';
import { nonTerminalOperationStatuses, operationStatuses } from '@core/primitives/operations/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  conversations,
  lifecycleOperations,
  projects,
  sshConnections,
  tasks,
  terminals,
  workspaces,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import type * as ServiceInstances from '@main/bootstrap/core/service-instances';
import type { OperationsSshManager } from './operations-service';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
  runMode: 'pause' as 'pause' | 'complete',
  runnerStarted: undefined as (() => void) | undefined,
  hostConnected: true,
  connectionListener: undefined as ((event: { type: string }) => void) | undefined,
  projectProvider: undefined as
    | {
        settings: { get(): Promise<{ preservePatterns: string[] }> };
        git: {
          checkout: {
            model: {
              state(): {
                snapshot(): Promise<{
                  data: {
                    kind: 'ok';
                    summary: { staged: number; unstaged: number; untracked: number };
                  };
                }>;
              };
            };
            getLog(): Promise<{ success: true; data: { commits: [] } }>;
          };
        };
      }
    | undefined,
  closeProject: vi.fn(async () => {}),
  deleteProjectData: vi.fn(async () => {}),
  deleteViewState: vi.fn(async () => ({ success: true, data: { deleted: 1 } })),
  deleteOrphanedMementos: vi.fn(async () => ({ success: true, data: { deleted: 1 } })),
  emitProjectEvent: vi.fn(),
  captureTelemetry: vi.fn(),
  publishNotification: vi.fn(),
  runOperationPlan: vi.fn(),
}));

const sshManager: OperationsSshManager = {
  on(_eventName, listener) {
    mocks.connectionListener = listener;
  },
  off() {
    mocks.connectionListener = undefined;
  },
  isConnected() {
    return mocks.hostConnected;
  },
};

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: () => mocks.projectProvider,
    closeProject: mocks.closeProject,
  },
}));

vi.mock('@main/core/projects/project-events', () => ({
  projectEvents: { _emit: mocks.emitProjectEvent },
}));

vi.mock('@core/services/pull-requests/node/pull-requests-registration', () => ({
  pullRequestsRegistration: { deleteProjectData: mocks.deleteProjectData },
}));

vi.mock('@main/gateway/desktop-workers', () => ({
  getMementosRuntimeClient: async () => ({
    deleteBySubject: mocks.deleteViewState,
    deleteOrphans: mocks.deleteOrphanedMementos,
  }),
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.captureTelemetry },
}));

vi.mock('@main/core/workspaces/workspace-bootstrap-service', () => ({
  workspaceBootstrapService: { resolveLegacyAutomation: vi.fn(async () => undefined) },
}));

vi.mock('@main/bootstrap/core/service-instances', async (importOriginal) => ({
  ...(await importOriginal<typeof ServiceInstances>()),
  getAppSettingsService: () => ({
    getWithMeta: vi.fn(async () => ({ value: {}, defaults: {}, overrides: {} })),
  }),
  getNotificationService: () => ({ publish: mocks.publishNotification }),
}));

vi.mock('./plans/compile-operation-plan', () => ({
  compileOperationPlan: vi.fn(
    async (operation: {
      kind: string;
      workspaceId?: string | null;
      payload: { deleteWorktree?: boolean };
    }) => {
      if (operation.kind === 'cleanup-sessions') {
        return {
          kind: operation.kind,
          steps: [
            {
              id: 'kill-tui-sessions',
              kind: 'kill-tui-sessions',
              label: 'Stop terminal sessions',
              destructive: false,
            },
          ],
        };
      }
      if (operation.kind === 'delete-workspace' && operation.workspaceId) {
        const [liveTask] = await mocks
          .db!.select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.workspaceId, operation.workspaceId), isNull(tasks.deletedAt)))
          .limit(1);
        if (liveTask) {
          return {
            kind: operation.kind,
            steps: [],
            preconditionFailure: {
              type: 'workspace-in-use',
              message: 'Workspace is still referenced by an active task.',
            },
          };
        }
      }
      return {
        kind: operation.kind,
        steps: [
          ...(operation.kind === 'delete-task' && operation.payload.deleteWorktree !== false
            ? [
                {
                  id: 'teardown-workspace',
                  kind: 'teardown-workspace',
                  label: 'Remove workspace',
                  destructive: true,
                },
              ]
            : []),
          ...(operation.kind === 'delete-workspace'
            ? [
                {
                  id: 'kill-tui-sessions',
                  kind: 'kill-tui-sessions',
                  label: 'Stop terminal sessions',
                  destructive: false,
                },
                {
                  id: 'teardown-workspace',
                  kind: 'teardown-workspace',
                  label: 'Remove workspace',
                  destructive: true,
                },
              ]
            : []),
          ...(operation.kind === 'archive-workspace'
            ? [
                {
                  id: 'clean-artifacts',
                  kind: 'clean-artifacts',
                  label: 'Remove ignored artifacts',
                  destructive: true,
                },
              ]
            : []),
          {
            id: `purge-${operation.kind}`,
            kind: 'purge-task-rows',
            label: 'Purge rows',
            destructive: true,
          },
        ],
      };
    }
  ),
}));

vi.mock('./plan-runner', () => ({
  runOperationPlan: mocks.runOperationPlan,
}));

describe('OperationsService crash recovery', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    vi.resetModules();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    const { setAppDb } = await import('@main/db/instance');
    setAppDb(fixture);
    mocks.runMode = 'pause';
    mocks.runnerStarted = undefined;
    mocks.hostConnected = true;
    mocks.connectionListener = undefined;
    mocks.projectProvider = undefined;
    mocks.closeProject.mockClear();
    mocks.deleteProjectData.mockClear();
    mocks.deleteViewState.mockClear();
    mocks.deleteOrphanedMementos.mockClear();
    mocks.emitProjectEvent.mockClear();
    mocks.captureTelemetry.mockClear();
    mocks.publishNotification.mockClear();
    mocks.runOperationPlan.mockReset();
    mocks.runOperationPlan.mockImplementation(
      async (
        operation: {
          kind:
            | 'delete-task'
            | 'delete-workspace'
            | 'archive-workspace'
            | 'delete-project'
            | 'cleanup-sessions';
          taskId: string | null;
          workspaceId: string | null;
          projectId: string | null;
        },
        _plan: unknown,
        options: { signal?: AbortSignal }
      ) => {
        mocks.runnerStarted?.();
        if (mocks.runMode === 'pause') {
          await new Promise<void>((resolve) => {
            if (options.signal?.aborted) resolve();
            else options.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          return err({ type: 'cancelled', message: 'Driver stopped' });
        }
        if (operation.taskId) {
          await mocks.db!.delete(tasks).where(eq(tasks.id, operation.taskId));
        }
        if (operation.kind === 'delete-workspace' && operation.workspaceId) {
          await mocks.db!.delete(workspaces).where(eq(workspaces.id, operation.workspaceId));
        }
        if (operation.kind === 'archive-workspace' && operation.workspaceId) {
          const [liveTask] = await mocks
            .db!.select({ id: tasks.id })
            .from(tasks)
            .where(and(eq(tasks.workspaceId, operation.workspaceId), isNull(tasks.deletedAt)))
            .limit(1);
          if (!liveTask) {
            await mocks.db!.delete(workspaces).where(eq(workspaces.id, operation.workspaceId));
          }
        }
        if (operation.kind === 'delete-project' && operation.projectId) {
          await mocks.db!.delete(projects).where(eq(projects.id, operation.projectId));
        }
        return ok();
      }
    );
    await fixture.db.insert(projects).values({ id: 'project-1', name: 'Project', path: '/repo' });
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Task',
      status: 'in_progress',
    });
  });

  afterEach(async () => {
    if (mocks.db) await assertLifecycleInvariants(mocks.db);
    const { resetAppDbForTests } = await import('@main/db/instance');
    resetAppDbForTests();
    fixture.close();
    mocks.db = undefined;
  });

  it('resumes a running delete after the driver restarts', async () => {
    const firstDriver = (await import('./operations-service')).operationsService;
    await firstDriver.initialize(sshManager);
    const runnerStarted = new Promise<void>((resolve) => {
      mocks.runnerStarted = resolve;
    });

    const enqueue = await firstDriver.enqueueDeleteTask({ taskId: 'task-1' });
    expect(enqueue.success).toBe(true);
    await runnerStarted;

    const [running] = await fixture.db.select().from(lifecycleOperations);
    const [tombstoned] = await fixture.db.select().from(tasks).where(eq(tasks.id, 'task-1'));
    expect(running?.status).toBe('running');
    expect(tombstoned?.deletedAt).not.toBeNull();

    await firstDriver.dispose();
    expect((await fixture.db.select().from(lifecycleOperations))[0]?.status).toBe('pending');

    mocks.runMode = 'complete';
    mocks.runnerStarted = undefined;
    const { resetAppDbForTests } = await import('@main/db/instance');
    resetAppDbForTests();
    vi.resetModules();
    const { setAppDb } = await import('@main/db/instance');
    setAppDb(fixture);
    const restartedDriver = (await import('./operations-service')).operationsService;
    await restartedDriver.initialize(sshManager);
    await restartedDriver.waitForIdle();

    const [completed] = await fixture.db.select().from(lifecycleOperations);
    expect(completed?.status).toBe('succeeded');
    expect(completed?.attempt).toBe(2);
    expect(await fixture.db.select().from(tasks).where(eq(tasks.id, 'task-1'))).toEqual([]);

    await restartedDriver.dispose();
  });

  it('runs all task deletes before the final project delete', async () => {
    await fixture.db.insert(tasks).values({
      id: 'task-2',
      projectId: 'project-1',
      name: 'Task 2',
      status: 'in_progress',
    });
    mocks.runMode = 'complete';

    const clock = new ManualClock(1_000_000);
    const { OperationsService } = await import('./operations-service');
    const driver = new OperationsService({ clock, sshManager });
    await driver.initialize();
    const result = await driver.enqueueDeleteProject('project-1');
    expect(result.success).toBe(true);
    await driver.waitForIdle();

    const operations = await fixture.db
      .select()
      .from(lifecycleOperations)
      .orderBy(lifecycleOperations.createdAt);
    expect(mocks.runOperationPlan.mock.calls.map(([operation]) => operation.kind)).toEqual([
      'delete-task',
      'delete-task',
      'delete-project',
    ]);
    expect(operations.every((operation) => operation.status === 'succeeded')).toBe(true);
    expect(await fixture.db.select().from(tasks)).toEqual([]);
    expect(await fixture.db.select().from(projects)).toEqual([]);

    await driver.dispose();
  });

  it('parks offline work and requires confirmation when reconnecting after it becomes stale', async () => {
    await fixture.db.insert(sshConnections).values({
      id: 'ssh-1',
      name: 'Remote',
      host: 'example.com',
      port: 22,
      username: 'user',
    });
    await fixture.db
      .update(projects)
      .set({ sshConnectionId: 'ssh-1' })
      .where(eq(projects.id, 'project-1'));
    mocks.hostConnected = false;
    mocks.runMode = 'complete';

    const clock = new ManualClock(1_000_000);
    const { OperationsService } = await import('./operations-service');
    const driver = new OperationsService({ clock, sshManager });
    await driver.initialize();
    const result = await driver.enqueueDeleteTask({ taskId: 'task-1' });
    expect(result.success).toBe(true);
    await driver.waitForIdle();

    const [blocked] = await fixture.db.select().from(lifecycleOperations);
    expect(blocked?.status).toBe('pending');
    const lease = driver.acquireDeletionState('task', 'task-1');
    const source = await lease.ready();
    const list = (await source.snapshot()).data as DeletionList;
    expect(list['task-1']?.status).toBe('blocked-host-offline');
    await lease.release();
    await clock.advanceBy(25 * 60 * 60 * 1_000);

    mocks.hostConnected = true;
    mocks.connectionListener?.({ type: 'reconnected' });
    await driver.waitForIdle();

    const [awaitingConfirmation] = await fixture.db.select().from(lifecycleOperations);
    expect(awaitingConfirmation?.status).toBe('awaiting-confirmation');
    expect(awaitingConfirmation?.payload.confirmationReason).toBe('stale');

    await driver.dispose();
  });

  it('parks destructive reconciler proposals until the user confirms them', async () => {
    mocks.runMode = 'complete';
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);

    await driver.proposeReconcilerTaskCleanup('task-1');
    await driver.waitForIdle();

    const [proposed] = await fixture.db.select().from(lifecycleOperations);
    expect(proposed?.status).toBe('awaiting-confirmation');
    expect(proposed?.payload.source).toBe('reconciler');
    expect(proposed?.payload.confirmationReason).toBe('reconciler-proposed');

    const retry = await driver.retryDelete('task', 'task-1');
    expect(retry.success).toBe(true);
    await driver.waitForIdle();

    expect((await fixture.db.select().from(lifecycleOperations))[0]?.status).toBe('succeeded');
    expect(await fixture.db.select().from(tasks).where(eq(tasks.id, 'task-1'))).toEqual([]);

    await driver.dispose();
  });

  it('requires confirmation for a stale pending local cleanup', async () => {
    const clock = new ManualClock(1_000_000);
    const { OperationsService } = await import('./operations-service');
    const driver = new OperationsService({ clock, sshManager });
    mocks.runMode = 'complete';

    const enqueue = await driver.enqueueDeleteTask({ taskId: 'task-1' });
    expect(enqueue.success).toBe(true);
    await clock.advanceBy(25 * 60 * 60 * 1_000);
    await driver.initialize();
    await driver.waitForIdle();

    const [parked] = await fixture.db.select().from(lifecycleOperations);
    expect(parked?.status).toBe('awaiting-confirmation');
    expect(parked?.payload.confirmationReason).toBe('stale');
    expect(mocks.runOperationPlan).not.toHaveBeenCalled();

    const retry = await driver.retryDelete('task', 'task-1');
    expect(retry.success).toBe(true);
    await driver.waitForIdle();
    expect((await fixture.db.select().from(lifecycleOperations))[0]?.status).toBe('succeeded');

    await driver.dispose();
  });

  it('runs stale non-destructive session cleanup without confirmation', async () => {
    const clock = new ManualClock(1_000_000);
    const { OperationsService } = await import('./operations-service');
    const driver = new OperationsService({ clock, sshManager });
    mocks.runMode = 'complete';

    await driver.proposeReconcilerSessionCleanup({
      entityId: 'session:orphan',
      tuiConversationIds: ['conversation-1'],
    });
    await clock.advanceBy(25 * 60 * 60 * 1_000);
    await driver.initialize();
    await driver.waitForIdle();

    const [completed] = await fixture.db.select().from(lifecycleOperations);
    expect(completed?.kind).toBe('cleanup-sessions');
    expect(completed?.status).toBe('succeeded');
    expect(mocks.runOperationPlan).toHaveBeenCalledOnce();

    await driver.dispose();
  });

  it('checks a dirty workspace when a pending cleanup aged before its first attempt', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
    });
    await fixture.db
      .update(tasks)
      .set({ workspaceId: 'workspace-1' })
      .where(eq(tasks.id, 'task-1'));
    mocks.projectProvider = {
      settings: { get: async () => ({ preservePatterns: [] }) },
      git: {
        checkout: {
          model: {
            state: () => ({
              snapshot: async () => ({
                data: {
                  kind: 'ok',
                  summary: { staged: 0, unstaged: 1, untracked: 0 },
                },
              }),
            }),
          },
          getLog: async () => ({ success: true, data: { commits: [] } }),
        },
      },
    };
    const clock = new ManualClock(1_000_000);
    const { OperationsService } = await import('./operations-service');
    const driver = new OperationsService({ clock, sshManager });
    mocks.runMode = 'complete';

    const enqueue = await driver.enqueueDeleteTask({ taskId: 'task-1' });
    expect(enqueue.success).toBe(true);
    await clock.advanceBy(11 * 60 * 1_000);
    await driver.initialize();
    await driver.waitForIdle();

    const [parked] = await fixture.db.select().from(lifecycleOperations);
    expect(parked?.status).toBe('awaiting-confirmation');
    expect(parked?.payload.confirmationReason).toBe('workspace-modified');
    expect(mocks.runOperationPlan).not.toHaveBeenCalled();

    await driver.dispose();
  });

  it('deduplicates concurrent task delete requests', async () => {
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);

    const results = await Promise.all([
      driver.enqueueDeleteTask({ taskId: 'task-1' }),
      driver.enqueueDeleteTask({ taskId: 'task-1' }),
    ]);

    expect(results.every((result) => result.success)).toBe(true);
    expect(await fixture.db.select().from(lifecycleOperations)).toHaveLength(1);

    await driver.dispose();
  });

  it('does not apply the dirty-worktree guard when the plan will not remove the workspace', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
    });
    await fixture.db
      .update(tasks)
      .set({ workspaceId: 'workspace-1', deletedAt: new Date().toISOString() })
      .where(eq(tasks.id, 'task-1'));
    await fixture.db.insert(lifecycleOperations).values({
      id: 'operation-1',
      kind: 'delete-task',
      status: 'pending',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      entityKey: 'task-1',
      hostRef: 'local',
      payload: {
        version: '1',
        source: 'user',
        workspacePath: '/repo/task-1',
        deleteWorktree: false,
        deleteBranch: false,
      },
      attempt: 1,
      createdAt: Date.now(),
    });
    mocks.projectProvider = {
      settings: { get: async () => ({ preservePatterns: [] }) },
      git: {
        checkout: {
          model: {
            state: () => ({
              snapshot: async () => ({
                data: {
                  kind: 'ok',
                  summary: { staged: 0, unstaged: 1, untracked: 0 },
                },
              }),
            }),
          },
          getLog: async () => ({ success: true, data: { commits: [] } }),
        },
      },
    };
    mocks.runMode = 'complete';

    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);
    await driver.waitForIdle();

    expect((await fixture.db.select().from(lifecycleOperations))[0]?.status).toBe('succeeded');
    await driver.dispose();
  });

  it('cleans project-local state when forgetting physical cleanup', async () => {
    await fixture.db
      .update(projects)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(projects.id, 'project-1'));
    await fixture.db.insert(lifecycleOperations).values({
      id: 'operation-1',
      kind: 'delete-project',
      status: 'awaiting-confirmation',
      projectId: 'project-1',
      entityKey: 'project-1',
      hostRef: 'local',
      payload: { version: '1', source: 'user', entityName: 'Project' },
      createdAt: Date.now(),
    });

    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);
    const result = await driver.forgetWithoutCleanup('project', 'project-1');

    expect(result.success).toBe(true);
    expect(mocks.closeProject).toHaveBeenCalledWith('project-1');
    expect(mocks.deleteProjectData).toHaveBeenCalledWith('project-1');
    expect(mocks.deleteViewState).toHaveBeenCalledWith({
      kind: 'project',
      key: 'project-1',
    });
    expect(mocks.deleteOrphanedMementos).toHaveBeenCalledWith({
      kind: 'task',
      validKeys: [],
    });
    expect(mocks.emitProjectEvent).toHaveBeenCalledWith('project:deleted', 'project-1');
    expect(await fixture.db.select().from(projects)).toEqual([]);

    await driver.dispose();
  });

  it('does not re-propose a path-only workspace cleanup after it was forgotten', async () => {
    const input = {
      projectId: 'project-1',
      workspacePath: '/repo/orphan',
      branchName: 'orphan',
    };
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);

    await driver.proposeReconcilerWorkspaceCleanup(input);
    const entityId = 'workspace-path:/repo/orphan';
    const forgotten = await driver.forgetWithoutCleanup('workspace', entityId);
    expect(forgotten.success).toBe(true);

    await driver.proposeReconcilerWorkspaceCleanup(input);

    expect(await fixture.db.select().from(lifecycleOperations)).toHaveLength(1);
    expect(mocks.publishNotification).toHaveBeenCalledTimes(1);
    await driver.dispose();
  });

  it('deduplicates session cleanup proposals by entity key', async () => {
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);
    const input = {
      entityId: 'session:orphan',
      terminalSessionIds: ['terminal-1'],
    };

    await Promise.all([
      driver.proposeReconcilerSessionCleanup(input),
      driver.proposeReconcilerSessionCleanup(input),
    ]);

    expect(await fixture.db.select().from(lifecycleOperations)).toHaveLength(1);
    await driver.dispose();
  });

  it('rejects deleting a workspace that is referenced by a live task', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
    });
    await fixture.db
      .update(tasks)
      .set({ workspaceId: 'workspace-1' })
      .where(eq(tasks.id, 'task-1'));
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);

    const result = await driver.enqueueDeleteWorkspace('workspace-1');

    expect(result).toEqual({
      success: false,
      error: {
        type: 'workspace-in-use',
        message: 'Workspace is still referenced by an active task.',
      },
    });
    expect(await fixture.db.select().from(lifecycleOperations)).toEqual([]);
    expect((await fixture.db.select().from(workspaces))[0]?.deletedAt).toBeNull();
    await driver.dispose();
  });

  it('fails a queued workspace delete if the workspace becomes used before draining', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
      deletedAt: new Date().toISOString(),
    });
    await fixture.db
      .update(tasks)
      .set({ workspaceId: 'workspace-1' })
      .where(eq(tasks.id, 'task-1'));
    await fixture.db.insert(lifecycleOperations).values({
      id: 'operation-1',
      kind: 'delete-workspace',
      status: 'pending',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      entityKey: 'workspace-1',
      hostRef: 'local',
      payload: {
        version: '1',
        source: 'user',
        workspacePath: '/repo/task-1',
        deleteWorktree: true,
      },
      createdAt: Date.now(),
    });
    mocks.runMode = 'complete';
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);
    await driver.waitForIdle();

    const [failed] = await fixture.db.select().from(lifecycleOperations);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('workspace-in-use');
    expect(mocks.runOperationPlan).not.toHaveBeenCalled();
    await driver.dispose();
  });

  it('archives an unused workspace and purges its row', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
    });
    mocks.runMode = 'complete';
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);

    const result = await driver.enqueueArchiveWorkspace({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/task-1',
      branchName: 'task-1',
    });
    expect(result.success).toBe(true);
    await driver.waitForIdle();

    expect((await fixture.db.select().from(lifecycleOperations))[0]).toMatchObject({
      kind: 'archive-workspace',
      status: 'succeeded',
      entityKey: 'workspace-1',
    });
    expect(await fixture.db.select().from(workspaces)).toEqual([]);
    await driver.dispose();
  });

  it('archives an in-use workspace but keeps its row', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
    });
    await fixture.db
      .update(tasks)
      .set({ workspaceId: 'workspace-1' })
      .where(eq(tasks.id, 'task-1'));
    mocks.runMode = 'complete';
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);

    const result = await driver.enqueueArchiveWorkspace({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/task-1',
    });
    expect(result.success).toBe(true);
    await driver.waitForIdle();

    expect((await fixture.db.select().from(lifecycleOperations))[0]?.status).toBe('succeeded');
    expect(await fixture.db.select().from(workspaces)).toHaveLength(1);
    await driver.dispose();
  });

  it('deduplicates archive and delete operations for the same workspace entity', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
    });
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);

    const archive = await driver.enqueueArchiveWorkspace({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/task-1',
    });
    const deletion = await driver.enqueueDeleteWorkspacePath({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/task-1',
      branchName: 'task-1',
    });

    expect(archive.success).toBe(true);
    expect(deletion.success).toBe(true);
    if (archive.success && deletion.success) {
      expect(deletion.data.operationId).toBe(archive.data.operationId);
    }
    expect(await fixture.db.select().from(lifecycleOperations)).toHaveLength(1);
    await driver.dispose();
  });

  it('requires confirmation before running a stale archive', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
    });
    const clock = new ManualClock(1_000_000);
    const { OperationsService } = await import('./operations-service');
    const driver = new OperationsService({ clock, sshManager });
    mocks.runMode = 'complete';

    const result = await driver.enqueueArchiveWorkspace({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo/task-1',
    });
    expect(result.success).toBe(true);
    await clock.advanceBy(25 * 60 * 60 * 1_000);
    await driver.initialize();
    await driver.waitForIdle();

    const [operation] = await fixture.db.select().from(lifecycleOperations);
    expect(operation?.status).toBe('awaiting-confirmation');
    expect(operation?.payload.confirmationReason).toBe('stale');
    expect(mocks.runOperationPlan).not.toHaveBeenCalled();
    await driver.dispose();
  });

  it('resolves task, workspace, and explicit session cleanup targets', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/task-1',
    });
    await fixture.db
      .update(tasks)
      .set({ workspaceId: 'workspace-1' })
      .where(eq(tasks.id, 'task-1'));
    await fixture.db.insert(tasks).values({
      id: 'task-2',
      projectId: 'project-1',
      name: 'Task 2',
      status: 'in_progress',
      workspaceId: 'workspace-1',
      deletedAt: new Date().toISOString(),
    });
    await fixture.db.insert(conversations).values([
      {
        id: 'acp-1',
        projectId: 'project-1',
        taskId: 'task-1',
        title: 'ACP',
        type: 'acp',
      },
      {
        id: 'tui-2',
        projectId: 'project-1',
        taskId: 'task-2',
        title: 'TUI',
        type: 'tui',
      },
    ]);
    await fixture.db.insert(terminals).values({
      id: 'terminal-2',
      projectId: 'project-1',
      taskId: 'task-2',
      name: 'Terminal',
    });
    const { resolveSessionTargets } = await import('./session-targets');
    const baseOperation: LifecycleOperationRow = {
      id: 'operation-1',
      kind: 'delete-workspace',
      status: 'pending',
      projectId: 'project-1',
      taskId: null,
      workspaceId: 'workspace-1',
      entityKey: 'workspace-1',
      hostRef: 'local',
      payload: { version: '1', source: 'user' },
      attempt: 0,
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
    };
    const context = {
      workspace: (await fixture.db.select().from(workspaces))[0],
      project: (await fixture.db.select().from(projects))[0],
      workspacePath: '/repo/task-1',
      projectPath: '/repo',
      workspaceKind: 'worktree' as const,
      branchName: 'task-1',
      preservePatterns: [],
    };

    const workspaceTargets = await resolveSessionTargets(baseOperation, context, {
      includeRuntimeTargets: false,
    });
    expect(workspaceTargets.acpConversationIds).toEqual(['acp-1']);
    expect(workspaceTargets.tuiConversationIds).toEqual(['tui-2']);
    expect(workspaceTargets.terminalSessionIds).toEqual(['project-1:task-2:terminal-2']);
    expect(workspaceTargets.tmuxSessionNames).toHaveLength(3);

    const taskTargets = await resolveSessionTargets(
      {
        ...baseOperation,
        kind: 'delete-task',
        taskId: 'task-1',
        entityKey: 'task-1',
      },
      context,
      { includeRuntimeTargets: false }
    );
    expect(taskTargets.acpConversationIds).toEqual(['acp-1']);
    expect(taskTargets.tuiConversationIds).toEqual([]);
    expect(taskTargets.terminalSessionIds).toEqual([]);
    expect(taskTargets.tmuxSessionNames).toHaveLength(1);

    const explicitTargets = await resolveSessionTargets(
      {
        ...baseOperation,
        kind: 'cleanup-sessions',
        workspaceId: null,
        payload: {
          version: '1',
          source: 'reconciler',
          acpConversationIds: ['orphan-acp'],
          terminalSessionIds: ['orphan-terminal'],
        },
      },
      { preservePatterns: [] }
    );
    expect(explicitTargets).toEqual({
      acpConversationIds: ['orphan-acp'],
      tuiConversationIds: [],
      terminalSessionIds: ['orphan-terminal'],
      tmuxSessionNames: [],
    });
    await fixture.db.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, 'task-2'));
  });

  it('converges a mixed batch to no tombstones or non-terminal operations', async () => {
    mocks.runMode = 'complete';
    const driver = (await import('./operations-service')).operationsService;
    await driver.initialize(sshManager);

    await Promise.all([
      driver.proposeReconcilerSessionCleanup({
        entityId: 'session:orphan',
        projectId: 'project-1',
        tuiConversationIds: ['conversation-1'],
      }),
      driver.enqueueDeleteProject('project-1'),
    ]);
    await driver.waitForIdle();

    const rows = await fixture.db.select().from(lifecycleOperations);
    expect(rows.every((row) => row.status === 'succeeded')).toBe(true);
    expect(await fixture.db.select().from(tasks).where(isNotNull(tasks.deletedAt))).toEqual([]);
    expect(await fixture.db.select().from(projects).where(isNotNull(projects.deletedAt))).toEqual(
      []
    );

    await driver.dispose();
  });
});

async function assertLifecycleInvariants(database: AppDb): Promise<void> {
  const operations = await database.select().from(lifecycleOperations);
  const nonTerminal = new Set<string>(nonTerminalOperationStatuses);
  const validStatuses = new Set<string>(operationStatuses);
  const activeCounts = new Map<string, number>();

  for (const operation of operations) {
    expect(validStatuses.has(operation.status)).toBe(true);
    expect(operation.status).not.toBe('blocked-host-offline');
    if (operation.status === 'awaiting-confirmation') {
      expect(operation.payload.confirmationReason).toBeDefined();
    }
    if (operation.status === 'succeeded' || operation.status === 'abandoned') {
      expect(operation.finishedAt).not.toBeNull();
    }
    if (operation.entityKey && nonTerminal.has(operation.status)) {
      activeCounts.set(operation.entityKey, (activeCounts.get(operation.entityKey) ?? 0) + 1);
    }
  }

  for (const count of activeCounts.values()) expect(count).toBeLessThanOrEqual(1);

  const tombstonedRows = [
    ...(await database.select({ id: tasks.id }).from(tasks).where(isNotNull(tasks.deletedAt))),
    ...(await database
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(isNotNull(workspaces.deletedAt))),
    ...(await database
      .select({ id: projects.id })
      .from(projects)
      .where(isNotNull(projects.deletedAt))),
  ];
  for (const row of tombstonedRows) {
    expect(
      operations.some(
        (operation) => operation.entityKey === row.id && nonTerminal.has(operation.status)
      )
    ).toBe(true);
  }
}

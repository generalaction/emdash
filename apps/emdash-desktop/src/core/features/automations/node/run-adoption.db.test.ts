import { hostRef } from '@emdash/core/primitives/host/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import type { WorkspaceRecord } from '@emdash/core/runtimes/workspace-registry/api';
import { ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceRegistryTable as workspaces } from '@core/features/workspaces/api/node/registry';
import { automations, projects, sshConnections, tasks } from '@core/services/app-db/node/schema';
import { adoptRun } from './run-adoption';

const remoteHost = hostRef('remote', 'ssh-1');

function remoteRunFixture(): AutomationRun {
  return {
    id: 'run-1',
    seq: 1,
    automationId: 'automation-1',
    status: 'done',
    triggerKind: 'manual',
    configSnapshot: {
      name: 'Review changes',
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
          host: remoteHost,
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
    generatedName: 'review-changes-run-1',
    scheduledAt: null,
    deadlineAt: null,
    startedAt: 100,
    finishedAt: 200,
    workspace: {
      host: remoteHost,
      path: {
        root: { kind: 'posix' },
        segments: ['worktrees', 'repo-12345678', 'review-changes-run-1'],
      },
    },
    branchName: 'review-changes-run-1',
    conversationId: null,
    sessionId: null,
    error: null,
  };
}

function hostWorkspaceRecord(id: string): WorkspaceRecord {
  return {
    id,
    kind: 'worktree',
    path: '/worktrees/repo-12345678/review-changes-run-1',
    parentId: 'repo-workspace-1',
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

describe('remote automation run adoption', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>> | undefined;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(sshConnections).values({
      id: 'ssh-1',
      name: 'Remote machine',
      host: 'example.com',
      username: 'jona',
    });
    await fixture.db.insert(workspaces).values({
      id: 'repo-workspace-1',
      type: 'project-ssh',
      kind: 'repository',
      location: 'remote',
      sshConnectionId: 'ssh-1',
      path: '/repo',
    });
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Remote project',
      repositoryWorkspaceId: 'repo-workspace-1',
    });
    await fixture.db.insert(automations).values({
      id: 'automation-1',
      name: 'Review changes',
      projectId: 'project-1',
      createdAt: 100,
      updatedAt: 100,
    });
  });

  afterEach(() => {
    fixture?.close();
  });

  it('persists the runtime workspace host and creates a desktop task', async () => {
    if (!fixture) throw new Error('Database fixture was not initialized');
    const getRun = vi.fn().mockResolvedValue(ok({ run: remoteRunFixture() }));
    const createWorkspace = vi.fn(async (input: { workspaceId: string }) =>
      ok(hostWorkspaceRecord(input.workspaceId))
    );
    const client = vi
      .fn()
      .mockResolvedValue(ok({ automations: { getRun }, workspaceRegistry: { createWorkspace } }));
    const notifyTaskCreated = vi.fn();
    const resolveProject = async (projectId: string) =>
      projectId === 'project-1'
        ? {
            id: projectId,
            type: 'ssh' as const,
            name: 'Remote project',
            path: '/repo',
            baseRef: 'main',
            connectionId: 'ssh-1',
            repositoryWorkspaceId: null,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          }
        : undefined;

    const result = await adoptRun(
      {
        db: fixture.db,
        getProjectById: resolveProject,
        runtime: {
          runtimes: { client },
          getProjectById: resolveProject,
        },
        taskService: { notifyTaskCreated },
      },
      'automation-1',
      'run-1'
    );

    expect(result.success).toBe(true);
    expect(client).toHaveBeenCalledWith(remoteHost);
    expect(getRun).toHaveBeenCalledWith({
      automationId: 'automation-1',
      runId: 'run-1',
    });
    expect(createWorkspace).toHaveBeenCalledWith({
      workspaceId: 'run-1',
      path: '/worktrees/repo-12345678/review-changes-run-1',
    });

    const workspacePath = '/worktrees/repo-12345678/review-changes-run-1';
    const [workspace] = await fixture.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.path, workspacePath));
    expect(workspace).toMatchObject({
      id: 'run-1',
      type: 'project-ssh',
      kind: 'worktree',
      location: 'remote',
      sshConnectionId: 'ssh-1',
      path: workspacePath,
    });

    const [task] = await fixture.db.select().from(tasks).where(eq(tasks.automationRunId, 'run-1'));
    expect(task).toMatchObject({
      projectId: 'project-1',
      workspaceId: workspace?.id,
      type: 'automation-run',
    });
    expect(notifyTaskCreated).toHaveBeenCalledOnce();
  });

  it('merges with a snapshot-sync-adopted row for the same path instead of duplicating it', async () => {
    if (!fixture) throw new Error('Database fixture was not initialized');
    const workspacePath = '/worktrees/repo-12345678/review-changes-run-1';
    // Snapshot-sync adopts unknown worktrees with a bare row (no config).
    await fixture.db.insert(workspaces).values({
      id: 'adopted-workspace',
      type: 'project-ssh',
      kind: 'worktree',
      location: 'remote',
      sshConnectionId: 'ssh-1',
      path: workspacePath,
      config: null,
    });

    const getRun = vi.fn().mockResolvedValue(ok({ run: remoteRunFixture() }));
    const createWorkspace = vi.fn().mockResolvedValue(ok(hostWorkspaceRecord('adopted-workspace')));
    const client = vi
      .fn()
      .mockResolvedValue(ok({ automations: { getRun }, workspaceRegistry: { createWorkspace } }));
    const resolveProject = async (projectId: string) =>
      projectId === 'project-1'
        ? {
            id: projectId,
            type: 'ssh' as const,
            name: 'Remote project',
            path: '/repo',
            baseRef: 'main',
            connectionId: 'ssh-1',
            repositoryWorkspaceId: null,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          }
        : undefined;

    const result = await adoptRun(
      {
        db: fixture.db,
        getProjectById: resolveProject,
        runtime: {
          runtimes: { client },
          getProjectById: resolveProject,
        },
        taskService: { notifyTaskCreated: vi.fn() },
      },
      'automation-1',
      'run-1'
    );

    expect(result.success).toBe(true);
    const rows = await fixture.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.path, workspacePath));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'adopted-workspace', path: workspacePath });
    expect(rows[0]?.config).not.toBeNull();

    const [task] = await fixture.db.select().from(tasks).where(eq(tasks.automationRunId, 'run-1'));
    expect(task?.workspaceId).toBe('adopted-workspace');
  });
});

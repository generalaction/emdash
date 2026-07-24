import { hostRef } from '@emdash/core/primitives/host/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import { ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeWorkspaceKey } from '@core/features/workspaces/api/node/workspace-key';
import {
  automations,
  projects,
  sshConnections,
  tasks,
  workspaces,
} from '@core/services/app-db/node/schema';
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
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Remote project',
      path: '/repo',
      workspaceProvider: 'ssh',
      sshConnectionId: 'ssh-1',
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
    const client = vi.fn().mockResolvedValue(ok({ automations: { getRun } }));
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

    const workspacePath = '/worktrees/repo-12345678/review-changes-run-1';
    const [workspace] = await fixture.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.key, computeWorkspaceKey('project-ssh', workspacePath, 'ssh-1')));
    expect(workspace).toMatchObject({
      type: 'project-ssh',
      kind: 'worktree',
      location: 'remote',
      sshConnectionId: 'ssh-1',
      path: workspacePath,
      branchName: 'review-changes-run-1',
    });

    const [task] = await fixture.db.select().from(tasks).where(eq(tasks.automationRunId, 'run-1'));
    expect(task).toMatchObject({
      projectId: 'project-1',
      workspaceId: workspace?.id,
      type: 'automation-run',
    });
    expect(notifyTaskCreated).toHaveBeenCalledOnce();
  });
});

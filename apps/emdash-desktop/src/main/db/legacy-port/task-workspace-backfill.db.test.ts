import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeWorkspaceKey } from '@main/core/workspaces/workspace-key';
import { projects, sshConnections, tasks, workspaces } from '@main/db/schema';
import { ensureImportedTaskWorkspaces } from './task-workspace-backfill';

describe('ensureImportedTaskWorkspaces', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');

    await fixture.db.insert(sshConnections).values({
      id: 'ssh-1',
      name: 'prod',
      host: 'example.com',
      port: 22,
      username: 'alice',
    });

    await fixture.db.insert(projects).values([
      {
        id: 'project-local',
        name: 'Local Project',
        path: '/repo/local',
        workspaceProvider: 'local',
      },
      {
        id: 'project-remote',
        name: 'Remote Project',
        path: '/srv/remote',
        workspaceProvider: 'ssh',
        sshConnectionId: 'ssh-1',
      },
    ]);
  });

  afterEach(() => {
    fixture.close();
  });

  it('creates worktree and repository workspaces for imported tasks', async () => {
    await fixture.db.insert(tasks).values([
      {
        id: 'task-root-1',
        projectId: 'project-local',
        name: 'Root task 1',
        status: 'in_progress',
      },
      {
        id: 'task-root-2',
        projectId: 'project-local',
        name: 'Root task 2',
        status: 'todo',
      },
      {
        id: 'task-worktree',
        projectId: 'project-remote',
        name: 'Worktree task',
        status: 'in_progress',
        taskBranch: 'feature/imported',
      },
    ]);

    ensureImportedTaskWorkspaces(fixture.db);

    const importedTasks = await fixture.db
      .select({
        id: tasks.id,
        workspaceId: tasks.workspaceId,
      })
      .from(tasks)
      .orderBy(tasks.id);

    const rootWorkspaceId = importedTasks.find((task) => task.id === 'task-root-1')?.workspaceId;
    expect(rootWorkspaceId).toBeTruthy();
    if (!rootWorkspaceId) throw new Error('expected root workspace id');
    expect(importedTasks.find((task) => task.id === 'task-root-2')?.workspaceId).toBe(
      rootWorkspaceId
    );

    const [project] = await fixture.db
      .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
      .from(projects)
      .where(eq(projects.id, 'project-local'));
    expect(project.repositoryWorkspaceId).toBe(rootWorkspaceId);

    const [rootWorkspace] = await fixture.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, rootWorkspaceId));
    expect(rootWorkspace).toMatchObject({
      kind: 'project-root',
      location: 'local',
      type: 'local',
      path: '/repo/local',
      key: computeWorkspaceKey('local', '/repo/local'),
    });

    const worktreeWorkspaceId = importedTasks.find(
      (task) => task.id === 'task-worktree'
    )?.workspaceId;
    expect(worktreeWorkspaceId).toBeTruthy();
    if (!worktreeWorkspaceId) throw new Error('expected worktree workspace id');

    const [worktreeWorkspace] = await fixture.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, worktreeWorkspaceId));
    expect(worktreeWorkspace).toMatchObject({
      kind: 'worktree',
      location: 'remote',
      type: 'project-ssh',
      sshConnectionId: 'ssh-1',
      branchName: 'feature/imported',
      path: null,
      key: null,
      config: {
        version: '2',
        git: { kind: 'use-branch', branchName: 'feature/imported' },
        workspace: { kind: 'new-worktree' },
      },
    });

    const workspaceCount = await fixture.db.select().from(workspaces);
    ensureImportedTaskWorkspaces(fixture.db);
    const workspaceCountAfterRerun = await fixture.db.select().from(workspaces);
    expect(workspaceCountAfterRerun).toHaveLength(workspaceCount.length);
  });

  it('reuses an existing repository workspace by key', async () => {
    const key = computeWorkspaceKey('local', '/repo/local');
    await fixture.db.insert(workspaces).values({
      id: 'existing-repo-workspace',
      kind: 'project-root',
      location: 'local',
      type: 'local',
      path: '/repo/local',
      key,
    });
    await fixture.db.insert(tasks).values({
      id: 'task-root',
      projectId: 'project-local',
      name: 'Root task',
      status: 'in_progress',
    });

    ensureImportedTaskWorkspaces(fixture.db);

    const [task] = await fixture.db
      .select({ workspaceId: tasks.workspaceId })
      .from(tasks)
      .where(eq(tasks.id, 'task-root'));
    const [project] = await fixture.db
      .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
      .from(projects)
      .where(eq(projects.id, 'project-local'));
    const workspaceRows = await fixture.db.select().from(workspaces);

    expect(task.workspaceId).toBe('existing-repo-workspace');
    expect(project.repositoryWorkspaceId).toBe('existing-repo-workspace');
    expect(workspaceRows).toHaveLength(1);
  });
});

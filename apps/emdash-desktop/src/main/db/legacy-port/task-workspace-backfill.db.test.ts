import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projects, sshConnections, tasks, workspaces } from '@core/services/app-db/node/schema';
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

    await fixture.db.insert(workspaces).values([
      {
        id: 'repo-local',
        type: 'local',
        kind: 'repository',
        location: 'local',
        path: '/repo/local',
      },
      {
        id: 'repo-remote',
        type: 'project-ssh',
        kind: 'repository',
        location: 'remote',
        sshConnectionId: 'ssh-1',
        path: '/srv/remote',
      },
    ]);

    await fixture.db.insert(projects).values([
      {
        id: 'project-local',
        name: 'Local Project',
        repositoryWorkspaceId: 'repo-local',
      },
      {
        id: 'project-remote',
        name: 'Remote Project',
        repositoryWorkspaceId: 'repo-remote',
      },
    ]);
  });

  afterEach(() => {
    fixture.close();
  });

  it('creates worktree workspaces and links imported tasks', async () => {
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

    // Branch-less imported tasks bind to the project's repository row.
    expect(importedTasks.find((task) => task.id === 'task-root-1')?.workspaceId).toBe('repo-local');
    expect(importedTasks.find((task) => task.id === 'task-root-2')?.workspaceId).toBe('repo-local');

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
      parentId: 'repo-remote',
      path: null,
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

    await fixture.db.update(tasks).set({ workspaceId: null }).where(eq(tasks.id, 'task-worktree'));
    ensureImportedTaskWorkspaces(fixture.db);

    const [repairedTask] = await fixture.db
      .select({ workspaceId: tasks.workspaceId })
      .from(tasks)
      .where(eq(tasks.id, 'task-worktree'));
    const workspaceCountAfterRepair = await fixture.db.select().from(workspaces);

    expect(repairedTask.workspaceId).toBe(worktreeWorkspaceId);
    expect(workspaceCountAfterRepair).toHaveLength(workspaceCount.length);
  });

  it('does not reuse worktree workspaces across projects with the same branch', async () => {
    await fixture.db.insert(workspaces).values({
      id: 'repo-local-2',
      type: 'local',
      kind: 'repository',
      location: 'local',
      path: '/repo/local-2',
    });
    await fixture.db.insert(projects).values({
      id: 'project-local-2',
      name: 'Local Project 2',
      repositoryWorkspaceId: 'repo-local-2',
    });
    await fixture.db.insert(tasks).values([
      {
        id: 'task-worktree-1',
        projectId: 'project-local',
        name: 'Worktree task 1',
        status: 'in_progress',
        taskBranch: 'feature/shared',
      },
      {
        id: 'task-worktree-2',
        projectId: 'project-local-2',
        name: 'Worktree task 2',
        status: 'in_progress',
        taskBranch: 'feature/shared',
      },
    ]);

    ensureImportedTaskWorkspaces(fixture.db);

    const importedTasks = await fixture.db
      .select({ id: tasks.id, workspaceId: tasks.workspaceId })
      .from(tasks)
      .orderBy(tasks.id);
    const workspaceIds = importedTasks.map((task) => task.workspaceId);
    const workspaceRows = await fixture.db.select().from(workspaces);
    const worktreeRows = workspaceRows.filter((workspace) => workspace.kind === 'worktree');
    const repositoryRows = workspaceRows.filter((workspace) => workspace.kind === 'repository');

    expect(workspaceIds.every(Boolean)).toBe(true);
    expect(new Set(workspaceIds).size).toBe(2);
    expect(worktreeRows).toHaveLength(2);
    expect(repositoryRows).toHaveLength(3);
    expect(worktreeRows.every((workspace) => workspace.parentId !== null)).toBe(true);
  });

  it('creates and links a repository row for a project left unlinked', async () => {
    await fixture.db.insert(projects).values({
      id: 'project-unlinked',
      name: 'Unlinked Project',
    });
    await fixture.db.insert(tasks).values({
      id: 'task-root',
      projectId: 'project-unlinked',
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
      .where(eq(projects.id, 'project-unlinked'));

    expect(task.workspaceId).toBeTruthy();
    expect(project.repositoryWorkspaceId).toBe(task.workspaceId);

    const [workspace] = await fixture.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, task.workspaceId!));
    expect(workspace).toMatchObject({ kind: 'repository', location: 'local' });
  });
});

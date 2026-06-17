import { randomUUID } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import { computeWorkspaceKey } from '@main/core/workspaces/workspace-key';
import type { AppDb, DrizzleTx } from '@main/db/client';
import { projects, tasks, workspaces } from '@main/db/schema';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';

type ProjectWorkspaceFields = {
  projectId: string;
  projectPath: string;
  workspaceProvider: string;
  sshConnectionId: string | null;
  repositoryWorkspaceId: string | null;
};

function deriveWorkspaceLocation(project: {
  workspaceProvider: string;
  sshConnectionId: string | null;
}): {
  location: 'local' | 'remote';
  type: 'local' | 'project-ssh';
  sshConnectionId: string | null;
} {
  const isRemote = project.workspaceProvider === 'ssh';
  return {
    location: isRemote ? 'remote' : 'local',
    type: isRemote ? 'project-ssh' : 'local',
    sshConnectionId: isRemote ? project.sshConnectionId : null,
  };
}

function buildImportedWorktreeConfig(branchName: string): WorkspaceConfig {
  return {
    version: '2',
    git: { kind: 'use-branch', branchName },
    workspace: { kind: 'new-worktree' },
  };
}

function ensureRepositoryWorkspace(tx: DrizzleTx, project: ProjectWorkspaceFields): string {
  if (project.repositoryWorkspaceId) {
    const [existingWorkspace] = tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, project.repositoryWorkspaceId))
      .limit(1)
      .all();

    if (existingWorkspace) return existingWorkspace.id;
  }

  const location = deriveWorkspaceLocation(project);
  const key = computeWorkspaceKey(
    location.type,
    project.projectPath,
    location.sshConnectionId ?? undefined
  );

  const [existingByKey] = tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.key, key))
    .limit(1)
    .all();

  const workspaceId = existingByKey?.id ?? randomUUID();

  if (!existingByKey) {
    tx.insert(workspaces)
      .values({
        id: workspaceId,
        kind: 'project-root',
        location: location.location,
        sshConnectionId: location.sshConnectionId,
        type: location.type,
        path: project.projectPath,
        key,
      })
      .run();
  }

  tx.update(projects)
    .set({ repositoryWorkspaceId: workspaceId })
    .where(eq(projects.id, project.projectId))
    .run();

  return workspaceId;
}

/**
 * Backfills the v1 workspace model for v0-imported tasks.
 *
 * This is intended to run inside the legacy import transaction. It only touches
 * tasks where `workspaceId` is null, so copied v1-beta tasks and reruns are left
 * alone.
 */
export function ensureImportedTaskWorkspaces(appDb: AppDb): void {
  appDb.transaction((tx) => {
    const rows = tx
      .select({
        taskId: tasks.id,
        taskBranch: tasks.taskBranch,
        projectId: projects.id,
        projectPath: projects.path,
        workspaceProvider: projects.workspaceProvider,
        sshConnectionId: projects.sshConnectionId,
        repositoryWorkspaceId: projects.repositoryWorkspaceId,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(isNull(tasks.workspaceId))
      .all();

    const repositoryWorkspaceIdByProjectId = new Map<string, string>();

    for (const row of rows) {
      const project = {
        projectId: row.projectId,
        projectPath: row.projectPath,
        workspaceProvider: row.workspaceProvider,
        sshConnectionId: row.sshConnectionId,
        repositoryWorkspaceId:
          repositoryWorkspaceIdByProjectId.get(row.projectId) ?? row.repositoryWorkspaceId,
      };

      let workspaceId: string;

      if (row.taskBranch) {
        workspaceId = randomUUID();
        const location = deriveWorkspaceLocation(project);

        tx.insert(workspaces)
          .values({
            id: workspaceId,
            kind: 'worktree',
            location: location.location,
            sshConnectionId: location.sshConnectionId,
            type: location.type,
            branchName: row.taskBranch,
            config: buildImportedWorktreeConfig(row.taskBranch),
          })
          .run();
      } else {
        workspaceId = ensureRepositoryWorkspace(tx, project);
        repositoryWorkspaceIdByProjectId.set(row.projectId, workspaceId);
      }

      tx.update(tasks).set({ workspaceId }).where(eq(tasks.id, row.taskId)).run();
    }
  });
}

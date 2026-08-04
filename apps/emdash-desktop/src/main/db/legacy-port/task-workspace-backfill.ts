import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { projects, tasks, workspaces } from '@core/services/app-db/node/schema';

type ProjectWorkspaceFields = {
  projectId: string;
  repositoryWorkspaceId: string | null;
  repositoryPath: string | null;
  repositoryLocation: 'local' | 'remote' | null;
  repositorySshConnectionId: string | null;
};

type HostIdentity = {
  location: 'local' | 'remote';
  type: 'local' | 'project-ssh';
  sshConnectionId: string | null;
};

function deriveHostIdentity(project: ProjectWorkspaceFields): HostIdentity {
  const isRemote = project.repositoryLocation === 'remote';
  return {
    location: isRemote ? 'remote' : 'local',
    type: isRemote ? 'project-ssh' : 'local',
    sshConnectionId: isRemote ? project.repositorySshConnectionId : null,
  };
}

function buildImportedWorktreeConfig(branchName: string): WorkspaceConfig {
  return {
    version: '2',
    git: { kind: 'use-branch', branchName },
    workspace: { kind: 'new-worktree' },
  };
}

/**
 * Resolves the project's repository workspace row, creating one when the
 * import left the project unlinked (should not happen for freshly ported
 * projects, but keeps reruns and partially imported databases safe).
 */
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

  const host = deriveHostIdentity(project);
  const workspaceId = randomUUID();
  tx.insert(workspaces)
    .values({
      id: workspaceId,
      type: host.type,
      kind: 'repository',
      location: host.location,
      sshConnectionId: host.sshConnectionId,
      path: project.repositoryPath,
    })
    .run();

  tx.update(projects)
    .set({ repositoryWorkspaceId: workspaceId })
    .where(eq(projects.id, project.projectId))
    .run();

  return workspaceId;
}

/**
 * Finds a live worktree row that already represents this imported branch
 * under the project's repository row. Branch identity lives in
 * `config.git.branchName`; the parent link scopes the match to the project.
 */
function findExistingWorktreeWorkspace(
  tx: DrizzleTx,
  repositoryWorkspaceId: string,
  branchName: string
): string | undefined {
  const rows = tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.kind, 'worktree'),
        isNull(workspaces.untrackedAt),
        eq(workspaces.parentId, repositoryWorkspaceId),
        sql`json_extract(${workspaces.config}, '$.git.branchName') = ${branchName}`
      )
    )
    .limit(2)
    .all();

  return rows.length === 1 ? rows[0]?.id : undefined;
}

/**
 * Backfills the workspace model for v0-imported tasks.
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
        repositoryWorkspaceId: projects.repositoryWorkspaceId,
        repositoryPath: workspaces.path,
        repositoryLocation: workspaces.location,
        repositorySshConnectionId: workspaces.sshConnectionId,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(workspaces, eq(workspaces.id, projects.repositoryWorkspaceId))
      .where(isNull(tasks.workspaceId))
      .all();

    const repositoryWorkspaceIdByProjectId = new Map<string, string>();

    for (const row of rows) {
      const project: ProjectWorkspaceFields = {
        projectId: row.projectId,
        repositoryWorkspaceId:
          repositoryWorkspaceIdByProjectId.get(row.projectId) ?? row.repositoryWorkspaceId,
        repositoryPath: row.repositoryPath,
        repositoryLocation: row.repositoryLocation,
        repositorySshConnectionId: row.repositorySshConnectionId,
      };

      const repositoryWorkspaceId = ensureRepositoryWorkspace(tx, project);
      repositoryWorkspaceIdByProjectId.set(row.projectId, repositoryWorkspaceId);

      let workspaceId: string;

      if (row.taskBranch) {
        const host = deriveHostIdentity(project);
        const existingWorkspaceId = findExistingWorktreeWorkspace(
          tx,
          repositoryWorkspaceId,
          row.taskBranch
        );
        workspaceId = existingWorkspaceId ?? randomUUID();

        if (!existingWorkspaceId) {
          tx.insert(workspaces)
            .values({
              id: workspaceId,
              type: host.type,
              kind: 'worktree',
              location: host.location,
              sshConnectionId: host.sshConnectionId,
              parentId: repositoryWorkspaceId,
              config: buildImportedWorktreeConfig(row.taskBranch),
            })
            .run();
        }
      } else {
        workspaceId = repositoryWorkspaceId;
      }

      tx.update(tasks).set({ workspaceId }).where(eq(tasks.id, row.taskId)).run();
    }
  });
}

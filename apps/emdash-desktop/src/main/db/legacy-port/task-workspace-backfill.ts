import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { computeWorkspaceKey } from '@core/features/workspaces/api/node/workspace-key';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { projects, tasks, workspaces } from '@core/services/app-db/node/schema';

type ProjectWorkspaceFields = {
  projectId: string;
  projectPath: string;
  workspaceProvider: string;
  sshConnectionId: string | null;
  repositoryWorkspaceId: string | null;
};

type TableInfoRow = {
  name: string;
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

function buildImportedWorktreeKey(
  project: ProjectWorkspaceFields,
  branchName: string,
  location: ReturnType<typeof deriveWorkspaceLocation>
): string {
  return computeWorkspaceKey(
    location.type,
    `${project.projectPath}#${branchName}`,
    location.sshConnectionId ?? undefined
  );
}

function insertRepositoryWorkspace(
  tx: DrizzleTx,
  input: {
    id: string;
    kind: string;
    location: string;
    sshConnectionId: string | null;
    type: string;
    path: string;
    key: string;
  }
): void {
  tx.run(sql`
    INSERT INTO workspaces (id, kind, location, ssh_connection_id, type, path, key)
    VALUES (
      ${input.id},
      ${input.kind},
      ${input.location},
      ${input.sshConnectionId},
      ${input.type},
      ${input.path},
      ${input.key}
    )
  `);
}

function insertWorktreeWorkspace(
  tx: DrizzleTx,
  input: {
    id: string;
    kind: string;
    location: string;
    sshConnectionId: string | null;
    parentId: string | null;
    type: string;
    key: string;
    branchName: string;
    config: WorkspaceConfig;
  }
): void {
  if (input.parentId) {
    tx.run(sql`
      INSERT INTO workspaces (
        id,
        kind,
        location,
        ssh_connection_id,
        parent_id,
        type,
        key,
        branch_name,
        config
      )
      VALUES (
        ${input.id},
        ${input.kind},
        ${input.location},
        ${input.sshConnectionId},
        ${input.parentId},
        ${input.type},
        ${input.key},
        ${input.branchName},
        ${JSON.stringify(input.config)}
      )
    `);
    return;
  }

  tx.run(sql`
    INSERT INTO workspaces (
      id,
      kind,
      location,
      ssh_connection_id,
      type,
      key,
      branch_name,
      config
    )
    VALUES (
      ${input.id},
      ${input.kind},
      ${input.location},
      ${input.sshConnectionId},
      ${input.type},
      ${input.key},
      ${input.branchName},
      ${JSON.stringify(input.config)}
    )
  `);
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
    insertRepositoryWorkspace(tx, {
      id: workspaceId,
      kind: 'project-root',
      location: location.location,
      sshConnectionId: location.sshConnectionId,
      type: location.type,
      path: project.projectPath,
      key,
    });
  }

  tx.update(projects)
    .set({ repositoryWorkspaceId: workspaceId })
    .where(eq(projects.id, project.projectId))
    .run();

  return workspaceId;
}

function workspaceColumnExists(appDb: AppDb, columnName: string): boolean {
  const rows = appDb.all(sql`PRAGMA table_info(workspaces)`) as TableInfoRow[];
  return rows.some((row) => row.name === columnName);
}

function findExistingWorktreeWorkspace(
  tx: DrizzleTx,
  project: ProjectWorkspaceFields,
  branchName: string,
  location: ReturnType<typeof deriveWorkspaceLocation>
): string | undefined {
  const key = buildImportedWorktreeKey(project, branchName, location);
  const [existingWorkspaceByKey] = tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.key, key))
    .limit(1)
    .all();

  if (existingWorkspaceByKey) return existingWorkspaceByKey.id;

  const conditions = [
    eq(workspaces.kind, 'worktree'),
    eq(workspaces.branchName, branchName),
    eq(workspaces.location, location.location),
    eq(workspaces.type, location.type),
    isNull(workspaces.key),
    location.sshConnectionId
      ? eq(workspaces.sshConnectionId, location.sshConnectionId)
      : isNull(workspaces.sshConnectionId),
  ];

  const existingWorkspaces = tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(...conditions))
    .limit(2)
    .all();

  return existingWorkspaces.length === 1 ? existingWorkspaces[0]?.id : undefined;
}

/**
 * Backfills the v1 workspace model for v0-imported tasks.
 *
 * This is intended to run inside the legacy import transaction. It only touches
 * tasks where `workspaceId` is null, so copied v1-beta tasks and reruns are left
 * alone.
 */
export function ensureImportedTaskWorkspaces(appDb: AppDb): void {
  const supportsWorkspaceParentId = workspaceColumnExists(appDb, 'parent_id');

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
        const repositoryWorkspaceId = ensureRepositoryWorkspace(tx, project);
        repositoryWorkspaceIdByProjectId.set(row.projectId, repositoryWorkspaceId);
        const location = deriveWorkspaceLocation(project);
        const existingWorkspaceId = findExistingWorktreeWorkspace(
          tx,
          project,
          row.taskBranch,
          location
        );
        workspaceId = existingWorkspaceId ?? randomUUID();

        if (!existingWorkspaceId) {
          insertWorktreeWorkspace(tx, {
            id: workspaceId,
            kind: 'worktree',
            location: location.location,
            sshConnectionId: location.sshConnectionId,
            parentId: supportsWorkspaceParentId ? repositoryWorkspaceId : null,
            type: location.type,
            key: buildImportedWorktreeKey(project, row.taskBranch, location),
            branchName: row.taskBranch,
            config: buildImportedWorktreeConfig(row.taskBranch),
          });
        } else if (supportsWorkspaceParentId) {
          tx.update(workspaces)
            .set({ parentId: repositoryWorkspaceId })
            .where(and(eq(workspaces.id, existingWorkspaceId), isNull(workspaces.parentId)))
            .run();
        }
      } else {
        workspaceId = ensureRepositoryWorkspace(tx, project);
        repositoryWorkspaceIdByProjectId.set(row.projectId, workspaceId);
      }

      tx.update(tasks).set({ workspaceId }).where(eq(tasks.id, row.taskId)).run();
    }
  });
}

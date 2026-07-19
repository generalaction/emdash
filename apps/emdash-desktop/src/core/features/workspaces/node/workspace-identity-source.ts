import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects, tasks, workspaces } from '@main/db/schema';
import {
  isRemoteWorkspaceRow,
  WorkspaceIdentityService,
  type WorkspaceIdentityRow,
  type WorkspaceIdentitySource,
} from './workspace-identity-service';

const drizzleWorkspaceIdentitySource: WorkspaceIdentitySource = {
  async findById(workspaceId) {
    const rows = await loadWorkspaceRows(eq(workspaces.id, workspaceId));
    return rows[0] ?? null;
  },
  async findRepositoryForProject(projectId) {
    const rows = await db
      .select({ workspaceId: projects.repositoryWorkspaceId })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    const workspaceId = rows[0]?.workspaceId;
    if (!workspaceId) return null;
    const identities = await loadWorkspaceRows(eq(workspaces.id, workspaceId));
    return identities[0] ?? null;
  },
  async findByPath(path) {
    return loadWorkspaceRows(eq(workspaces.path, path));
  },
};

async function loadWorkspaceRows(predicate: SQL): Promise<WorkspaceIdentityRow[]> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      type: workspaces.type,
      location: workspaces.location,
      sshConnectionId: workspaces.sshConnectionId,
      path: workspaces.path,
    })
    .from(workspaces)
    .where(and(predicate, isNull(workspaces.deletedAt)));

  const resolved = await Promise.all(
    rows.map(async (row): Promise<WorkspaceIdentityRow | null> => {
      if (!row.path) return null;
      const projectId = await resolveWorkspaceProjectId(row.workspaceId);
      if (!projectId) return null;
      const sshConnectionId =
        row.sshConnectionId ??
        (isRemoteWorkspaceRow(row) ? await resolveProjectSshConnectionId(projectId) : null);
      return { ...row, path: row.path, projectId, sshConnectionId };
    })
  );
  return resolved.filter((row): row is WorkspaceIdentityRow => row !== null);
}

async function resolveWorkspaceProjectId(workspaceId: string): Promise<string | null> {
  const taskRows = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .limit(1);
  if (taskRows[0]) return taskRows[0].projectId;

  const projectRows = await db
    .select({ projectId: projects.id })
    .from(projects)
    .where(and(eq(projects.repositoryWorkspaceId, workspaceId), isNull(projects.deletedAt)))
    .limit(1);
  return projectRows[0]?.projectId ?? null;
}

async function resolveProjectSshConnectionId(projectId: string): Promise<string | null> {
  const rows = await db
    .select({ sshConnectionId: projects.sshConnectionId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  return rows[0]?.sshConnectionId ?? null;
}

export const workspaceIdentityService = new WorkspaceIdentityService(
  drizzleWorkspaceIdentitySource
);

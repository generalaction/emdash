import type { HostRef } from '@emdash/core/primitives/host/api';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Project } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, type ProjectRow } from '@core/services/app-db/node/schema';

export function projectFromRow(row: ProjectRow): Project {
  return row.workspaceProvider === 'local'
    ? {
        type: 'local',
        id: row.id,
        name: row.name,
        path: row.path,
        baseRef: row.baseRef ?? 'main',
        repositoryWorkspaceId: row.repositoryWorkspaceId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    : {
        type: 'ssh',
        id: row.id,
        name: row.name,
        path: row.path,
        baseRef: row.baseRef ?? 'main',
        connectionId: row.sshConnectionId!,
        repositoryWorkspaceId: row.repositoryWorkspaceId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
}

export async function getProjects(db: AppDb): Promise<Project[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.updatedAt));
  return rows.map(projectFromRow);
}

export async function getProjectById(db: AppDb, projectId: string): Promise<Project | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) return undefined;
  return projectFromRow(row);
}

export async function getProjectByPath(
  db: AppDb,
  host: HostRef,
  path: string
): Promise<Project | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(
      host.type === 'local'
        ? and(
            eq(projects.workspaceProvider, 'local'),
            eq(projects.path, path),
            isNull(projects.deletedAt)
          )
        : and(
            eq(projects.workspaceProvider, 'ssh'),
            eq(projects.sshConnectionId, host.id),
            eq(projects.path, path),
            isNull(projects.deletedAt)
          )
    )
    .limit(1);
  if (!row) return undefined;
  return projectFromRow(row);
}

import type { HostRef } from '@emdash/core/primitives/host/api';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { LocalProject, Project, SshProject } from '@core/primitives/projects/api';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function getProjects(): Promise<(LocalProject | SshProject)[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.updatedAt));
  return rows.map((row) =>
    row.workspaceProvider === 'local'
      ? {
          type: 'local' as const,
          id: row.id,
          name: row.name,
          path: row.path,
          baseRef: row.baseRef ?? 'main',
          repositoryWorkspaceId: row.repositoryWorkspaceId ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      : {
          type: 'ssh' as const,
          id: row.id,
          name: row.name,
          path: row.path,
          baseRef: row.baseRef ?? 'main',
          connectionId: row.sshConnectionId!,
          repositoryWorkspaceId: row.repositoryWorkspaceId ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
  );
}

export async function getProjectById(
  projectId: string
): Promise<LocalProject | SshProject | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) return undefined;
  if (row.workspaceProvider === 'local') {
    return {
      type: 'local' as const,
      id: row.id,
      name: row.name,
      path: row.path,
      baseRef: row.baseRef ?? 'main',
      repositoryWorkspaceId: row.repositoryWorkspaceId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  return {
    type: 'ssh' as const,
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

export async function getProjectByPath(host: HostRef, path: string): Promise<Project | undefined> {
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
  return row.workspaceProvider === 'local'
    ? {
        type: 'local' as const,
        id: row.id,
        name: row.name,
        path: row.path,
        baseRef: row.baseRef ?? 'main',
        repositoryWorkspaceId: row.repositoryWorkspaceId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    : {
        type: 'ssh' as const,
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

import { and, desc, eq } from 'drizzle-orm';
import type { LocalProject, SshProject } from '@shared/projects';
import { getStoredProjectIconDataUrl } from '@main/core/projects/icons/storage';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function getProjects(): Promise<(LocalProject | SshProject)[]> {
  const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt));
  return rows.map((row) =>
    row.workspaceProvider === 'local'
      ? {
          type: 'local' as const,
          id: row.id,
          name: row.name,
          path: row.path,
          baseRef: row.baseRef ?? 'main',
          iconDataUrl: getStoredProjectIconDataUrl(row.id),
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
          iconDataUrl: getStoredProjectIconDataUrl(row.id),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
  );
}

export async function getProjectById(
  projectId: string
): Promise<LocalProject | SshProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return undefined;
  if (row.workspaceProvider === 'local') {
    return {
      type: 'local' as const,
      id: row.id,
      name: row.name,
      path: row.path,
      baseRef: row.baseRef ?? 'main',
      iconDataUrl: getStoredProjectIconDataUrl(row.id),
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
    iconDataUrl: getStoredProjectIconDataUrl(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getLocalProjectByPath(path: string): Promise<LocalProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.path, path)).limit(1);
  if (!row) return undefined;
  return {
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    iconDataUrl: getStoredProjectIconDataUrl(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getSshProjectByPath(
  path: string,
  connectionId: string
): Promise<SshProject | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.path, path), eq(projects.sshConnectionId, connectionId)))
    .limit(1);
  if (!row) return undefined;
  return {
    type: 'ssh' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    connectionId: row.sshConnectionId!,
    iconDataUrl: getStoredProjectIconDataUrl(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

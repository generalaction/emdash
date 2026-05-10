import { and, desc, eq } from 'drizzle-orm';
import type { LocalProject, SshProject } from '@shared/projects';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

type ProjectRow = typeof projects.$inferSelect;

function rowToLocalProject(row: ProjectRow): LocalProject {
  return {
    type: 'local',
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    archived: row.archived,
    icon: row.icon,
    iconColor: row.iconColor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToSshProject(row: ProjectRow, connectionId: string): SshProject {
  return {
    type: 'ssh',
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    connectionId,
    archived: row.archived,
    icon: row.icon,
    iconColor: row.iconColor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Map a DB row to a domain project. Returns null for orphaned SSH rows whose
 * connection was deleted (FK is `onDelete: 'set null'`) or for rows with an
 * unrecognized workspaceProvider.
 */
function mapProjectRow(row: ProjectRow): LocalProject | SshProject | null {
  if (row.workspaceProvider === 'local') return rowToLocalProject(row);
  if (row.workspaceProvider === 'ssh') {
    if (!row.sshConnectionId) return null;
    return rowToSshProject(row, row.sshConnectionId);
  }
  return null;
}

export async function getProjects(): Promise<(LocalProject | SshProject)[]> {
  const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt));
  return rows.map(mapProjectRow).filter((p): p is LocalProject | SshProject => p !== null);
}

export async function getProjectById(
  projectId: string
): Promise<LocalProject | SshProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return undefined;
  return mapProjectRow(row) ?? undefined;
}

export async function getLocalProjectByPath(path: string): Promise<LocalProject | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.path, path), eq(projects.workspaceProvider, 'local')))
    .limit(1);
  if (!row) return undefined;
  return rowToLocalProject(row);
}

export async function getSshProjectByPath(
  path: string,
  connectionId: string
): Promise<SshProject | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.path, path),
        eq(projects.workspaceProvider, 'ssh'),
        eq(projects.sshConnectionId, connectionId)
      )
    )
    .limit(1);
  if (!row) return undefined;
  return rowToSshProject(row, connectionId);
}

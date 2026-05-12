import { and, desc, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { LocalProject, SshProject } from '@shared/projects';

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

function rowToSshProject(row: ProjectRow): SshProject {
  return {
    type: 'ssh',
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    connectionId: row.sshConnectionId!,
    archived: row.archived,
    icon: row.icon,
    iconColor: row.iconColor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getProjects(): Promise<(LocalProject | SshProject)[]> {
  const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt));
  return rows.map((row) =>
    row.workspaceProvider === 'local' ? rowToLocalProject(row) : rowToSshProject(row)
  );
}

export async function getProjectById(
  projectId: string
): Promise<LocalProject | SshProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return undefined;
  return row.workspaceProvider === 'local' ? rowToLocalProject(row) : rowToSshProject(row);
}

export async function getLocalProjectByPath(path: string): Promise<LocalProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.path, path)).limit(1);
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
    .where(and(eq(projects.path, path), eq(projects.sshConnectionId, connectionId)))
    .limit(1);
  if (!row) return undefined;
  return rowToSshProject(row);
}

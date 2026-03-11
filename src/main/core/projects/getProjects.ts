import { desc } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { LocalProject, SshProject } from './types';

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
          gitRemote: row.gitRemote ?? undefined,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      : {
          type: 'ssh' as const,
          id: row.id,
          name: row.name,
          path: row.path,
          baseRef: row.baseRef ?? 'main',
          gitRemote: row.gitRemote ?? undefined,
          connectionId: row.sshConnectionId!,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
  );
}

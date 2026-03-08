import { desc, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { LocalProject } from './types';

export async function getProjects(): Promise<LocalProject[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.isRemote, 0))
    .orderBy(desc(projects.updatedAt));

  return rows.map((row) => ({
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    gitRemote: row.gitRemote ?? undefined,
    gitBranch: row.gitBranch ?? undefined,
    github: row.githubRepository
      ? { repository: row.githubRepository, connected: row.githubConnected === 1 }
      : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

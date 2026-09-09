import { and, eq, isNull } from 'drizzle-orm';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects } from '@core/services/app-db/node/schema';

/**
 * Changes a project's display name. Nothing keys on the name, but the search index
 * caches it, so listeners are told through `project:renamed`.
 */
export async function renameProject(db: AppDb, projectId: string, name: string): Promise<void> {
  const nextName = name.trim();
  if (nextName.length === 0) throw new Error('Project name cannot be empty');

  const updated = await db
    .update(projects)
    .set({ name: nextName, updatedAt: new Date().toISOString() })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .returning({ id: projects.id });
  if (updated.length === 0) throw new Error(`Project ${projectId} not found`);

  appDbPokes.projects.poke({ projectId });
  projectEvents._emit('project:renamed', projectId, nextName);
}

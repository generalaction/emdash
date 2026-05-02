import { eq, sql } from 'drizzle-orm';
import { MAX_PROJECT_NAME_LENGTH } from '@shared/projects';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { capture } from '@main/lib/telemetry';

export async function renameProject(projectId: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Project name cannot be empty');
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    throw new Error(`Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`);
  }

  const result = await db
    .update(projects)
    .set({ name: trimmed, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(projects.id, projectId));

  if (result.changes === 0) throw new Error(`Project not found: ${projectId}`);

  capture('project_renamed', { project_id: projectId });
}

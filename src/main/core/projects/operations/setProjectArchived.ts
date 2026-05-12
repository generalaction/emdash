import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function setProjectArchived(projectId: string, archived: boolean): Promise<void> {
  await db
    .update(projects)
    .set({ archived, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(projects.id, projectId));
}

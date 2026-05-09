import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function updateProjectAppearance(
  projectId: string,
  icon: string | null,
  iconColor: string | null
): Promise<void> {
  await db
    .update(projects)
    .set({ icon, iconColor, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(projects.id, projectId));
}

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function updateProjectConnection(
  projectId: string,
  connectionId: string
): Promise<void> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  if (!row) throw new Error(`Project ${projectId} not found`);
  if (row.workspaceProvider !== 'ssh')
    throw new Error(`Project ${projectId} is not an SSH project`);
  await db
    .update(projects)
    .set({ sshConnectionId: connectionId, updatedAt: new Date().toISOString() })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
}

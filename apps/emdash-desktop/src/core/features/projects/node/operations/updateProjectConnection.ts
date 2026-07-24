import { and, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects } from '@core/services/app-db/node/schema';

export async function updateProjectConnection(
  db: AppDb,
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

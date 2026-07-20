import { and, eq, isNull } from 'drizzle-orm';
import { projects } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';

export async function updateProjectConnection(
  projectId: string,
  connectionId: string
): Promise<void> {
  const [row] = await getAppDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  if (!row) throw new Error(`Project ${projectId} not found`);
  if (row.workspaceProvider !== 'ssh')
    throw new Error(`Project ${projectId} is not an SSH project`);
  await getAppDb()
    .update(projects)
    .set({ sshConnectionId: connectionId, updatedAt: new Date().toISOString() })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
}

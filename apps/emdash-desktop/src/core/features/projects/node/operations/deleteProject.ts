import type { WorkspaceRemovalBroker } from '@core/features/workspaces/api/node/operations/workspace-removal';
import type { OperationsEngine } from '@core/services/operations/node';
import { enqueueDeleteProject } from './delete-project-definition';

export async function deleteProject(
  operations: OperationsEngine,
  runtimes: WorkspaceRemovalBroker,
  id: string
): Promise<void> {
  const result = await enqueueDeleteProject(operations, runtimes, id);
  if (!result.success && result.error.type !== 'project-not-found') {
    throw new Error(result.error.message);
  }
}

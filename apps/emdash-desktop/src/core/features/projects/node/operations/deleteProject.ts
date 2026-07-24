import type { OperationsEngine } from '@core/services/operations/node';
import { enqueueDeleteProject } from './delete-project-definition';

export async function deleteProject(operations: OperationsEngine, id: string): Promise<void> {
  const result = await enqueueDeleteProject(operations, id);
  if (!result.success && result.error.type !== 'project-not-found') {
    throw new Error(result.error.message);
  }
}

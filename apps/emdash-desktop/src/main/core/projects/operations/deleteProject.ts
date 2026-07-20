import { operationsService } from '@main/core/operations/operations-service';

export async function deleteProject(id: string): Promise<void> {
  await operationsService.initialize();
  const result = await operationsService.enqueueDeleteProject(id);
  if (!result.success && result.error.type !== 'project-not-found') {
    throw new Error(result.error.message);
  }
}

import type { OperationsService } from '@main/core/operations/operations-service';

export async function deleteProject(id: string): Promise<void> {
  const operationsService = await getOperationsService();
  await operationsService.initialize();
  const result = await operationsService.enqueueDeleteProject(id);
  if (!result.success && result.error.type !== 'project-not-found') {
    throw new Error(result.error.message);
  }
}

async function getOperationsService(): Promise<OperationsService> {
  return (await import('@main/core/operations/operations-service')).operationsService;
}

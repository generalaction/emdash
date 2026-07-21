import { enqueueDeleteProject } from './delete-project-definition';

export async function deleteProject(id: string): Promise<void> {
  const result = await enqueueDeleteProject(id);
  if (!result.success && result.error.type !== 'project-not-found') {
    throw new Error(result.error.message);
  }
}

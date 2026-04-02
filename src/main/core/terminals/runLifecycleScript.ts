import { projectManager } from '../projects/project-manager';
import { LocalProjectSettingsProvider } from '../projects/settings/project-settings';

export async function runLifecycleScript({
  projectId,
  taskId,
  type,
}: {
  projectId: string;
  taskId: string;
  type: 'setup' | 'run' | 'teardown';
}) {
  const project = projectManager.getProject(projectId);
  if (!project) throw new Error('Project not found');

  const task = project.getTask(taskId);
  if (!task?.lifecycleService) throw new Error('Task not provisioned');

  const taskSettings = await new LocalProjectSettingsProvider(task.taskPath).get();
  const script = taskSettings?.scripts?.[type];
  if (!script) return;

  await task.lifecycleService.executeLifecycleScript({ type, script });
}

import { projectManager } from '../projects/project-manager';
import { getEffectiveTaskSettings } from '../projects/settings/task-settings';

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

  const task = project?.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const settings = await getEffectiveTaskSettings({
    projectSettings: project.settings,
    taskFs: task.workspace.fs,
  });
  const script = settings.scripts?.[type];
  if (!script) return;
  await task.workspace.lifecycleService.runLifecycleScript({ type, script });
}

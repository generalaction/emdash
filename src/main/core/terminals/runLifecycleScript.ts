import { projectManager } from '../projects/project-manager';
import { getEffectiveTaskSettings } from '../projects/settings/task-settings';
import { TaskLifecycleService } from '../tasks/task-lifecycle-service';

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
    taskFs: task.fs,
  });
  const script = settings.scripts?.[type];
  if (!script) return;

  const lifecycle = new TaskLifecycleService({
    projectId,
    taskId,
    terminals: task.terminals,
  });

  await lifecycle.runLifecycleScript({ type, script });
}

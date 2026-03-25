import { projectManager } from '../projects/project-manager';
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

  const script = (await project?.settings.get())?.scripts?.[type];
  if (!script) return;

  const task = project?.getTask(taskId);
  if (!task) throw new Error('Task not found');

  const lifecycle = new TaskLifecycleService({
    projectId,
    taskId,
    taskPath: task.taskPath,
    terminals: task.terminals,
  });

  await lifecycle.runLifecycleScript({ type, script }, { shouldRespawn: true });
}

import { projectManager } from '../projects/project-manager';

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

  await task.terminals.runLifecycleScript({ type, script });
}

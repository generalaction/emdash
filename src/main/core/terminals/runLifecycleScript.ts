import { projectManager } from '../projects/project-manager';
import { getEffectiveTaskSettings } from '../projects/settings/task-settings';
import { TaskLifecycleService } from '../tasks/task-lifecycle-service';
import { getLocalExec } from '../utils/exec';

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
  const projectSettings = await project.settings.get();
  const settings = await getEffectiveTaskSettings({
    projectSettings: project.settings,
    taskFs: task.fs,
  });
  const script = settings.scripts?.[type];
  if (!script) return;

  const lifecycle = new TaskLifecycleService({
    projectId,
    taskId,
    taskPath: task.taskPath,
    terminals: task.terminals,
    tmux: projectSettings.tmux ?? false,
    shellSetup: settings.shellSetup ?? projectSettings.shellSetup,
    exec: getLocalExec(),
  });

  await lifecycle.runLifecycleScript({ type, script }, { shouldRespawn: true });
}

import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import { resolveWorkspace } from '../projects/utils';

export async function prepareLifecycleScript({
  projectId,
  workspaceId,
  type,
}: {
  projectId: string;
  workspaceId: string;
  type: 'setup' | 'run' | 'teardown';
}): Promise<void> {
  const workspace = resolveWorkspace(projectId, workspaceId);
  if (!workspace) throw new Error('Workspace not found');

  const settings = await getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFs: workspace.fs,
  });
  const script = settings.scripts?.[type];
  if (!script) return;

  await workspace.lifecycleService.prepareLifecycleScript({
    type,
    script,
    shellSetup: settings.shellSetup,
  });
}

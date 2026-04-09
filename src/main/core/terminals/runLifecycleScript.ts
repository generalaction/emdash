import { getEffectiveTaskSettings } from '../projects/settings/task-settings';
import { resolveWorkspace } from '../projects/utils';

export async function runLifecycleScript({
  projectId,
  workspaceId,
  type,
}: {
  projectId: string;
  workspaceId: string;
  type: 'setup' | 'run' | 'teardown';
}) {
  const workspace = resolveWorkspace(projectId, workspaceId);
  if (!workspace) throw new Error('Workspace not found');

  const settings = await getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFs: workspace.fs,
  });
  const script = settings.scripts?.[type];
  if (!script) return;
  await workspace.lifecycleService.runLifecycleScript({ type, script });
}

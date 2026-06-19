import { resolveLifecycleScript } from './lifecycle-script-settings';

export async function prepareLifecycleScript({
  projectId,
  workspaceId,
  type,
}: {
  projectId: string;
  workspaceId: string;
  type: 'setup' | 'run' | 'teardown';
}): Promise<void> {
  const { workspace, script, shellSetup } = await resolveLifecycleScript({
    projectId,
    workspaceId,
    type,
  });
  if (!script) return;

  await workspace.lifecycleService.prepareLifecycleScript({
    type,
    script,
    shellSetup,
  });
}

import { ok, type Result } from '@emdash/shared';
import { resolveLifecycleScript } from './lifecycle-script-settings';
import type { LifecycleScriptSettingsError } from './lifecycle-script-settings';

export async function prepareLifecycleScript({
  projectId,
  workspaceId,
  type,
}: {
  projectId: string;
  workspaceId: string;
  type: 'setup' | 'run' | 'teardown';
}): Promise<Result<void, LifecycleScriptSettingsError>> {
  const resolved = await resolveLifecycleScript({
    projectId,
    workspaceId,
    type,
  });
  if (!resolved.success) return resolved;
  const { workspace, script, shellSetup } = resolved.data;
  if (!script) return ok();

  await workspace.lifecycleService.prepareLifecycleScript({
    type,
    script,
    shellSetup,
  });
  return ok();
}

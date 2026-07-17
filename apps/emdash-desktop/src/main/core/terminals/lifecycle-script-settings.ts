import { err, ok, type Result } from '@emdash/shared';
import type { LifecycleScriptType } from '@core/primitives/tasks/api';
import type { Workspace } from '@main/core/workspaces/workspace';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import { resolveWorkspace } from '../projects/utils';

export type LifecycleScriptSettingsError =
  | { type: 'not_found'; entity: 'workspace'; workspaceId: string }
  | { type: 'fs_error'; message: string };

/**
 * Reads the effective lifecycle script config for an already-resolved workspace.
 * This is used by callers that already have a Workspace, such as workspace setup/teardown hooks.
 */
export async function resolveLifecycleScriptForWorkspace(
  workspace: Workspace,
  type: LifecycleScriptType
): Promise<Result<{ script?: string; shellSetup?: string }, LifecycleScriptSettingsError>> {
  const settings = await getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFiles: workspace.files,
    taskConfigPath: workspace.configPath,
  });
  return ok({
    script: settings.scripts?.[type],
    shellSetup: settings.shellSetup,
  });
}

/**
 * Resolves a workspace by id, then reads the effective lifecycle script config for it.
 * This is used by RPC adapters that only receive ids from the renderer.
 */
export async function resolveLifecycleScript({
  projectId,
  workspaceId,
  type,
}: {
  projectId: string;
  workspaceId: string;
  type: LifecycleScriptType;
}): Promise<
  Result<
    { workspace: Workspace; script?: string; shellSetup?: string },
    LifecycleScriptSettingsError
  >
> {
  const workspace = resolveWorkspace(projectId, workspaceId);
  if (!workspace) return err({ type: 'not_found', entity: 'workspace', workspaceId });

  const settings = await resolveLifecycleScriptForWorkspace(workspace, type);
  if (!settings.success) return settings;
  return ok({ workspace, ...settings.data });
}

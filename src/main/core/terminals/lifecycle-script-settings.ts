import type { Workspace } from '@main/core/workspaces/workspace';
import type { LifecycleScriptType } from '@shared/events/taskEvents';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import { resolveWorkspace } from '../projects/utils';

/**
 * Reads the effective lifecycle script config for an already-resolved workspace.
 * This is used by callers that already have a Workspace, such as workspace setup/teardown hooks.
 */
export async function resolveLifecycleScriptForWorkspace(
  workspace: Workspace,
  type: LifecycleScriptType
): Promise<{ script?: string; shellSetup?: string }> {
  const settings = await getEffectiveTaskSettings({
    projectSettings: workspace.settings,
    taskFs: workspace.fs,
  });
  return {
    script: settings.scripts?.[type],
    shellSetup: settings.shellSetup,
  };
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
}): Promise<{ workspace: Workspace; script?: string; shellSetup?: string }> {
  const workspace = resolveWorkspace(projectId, workspaceId);
  if (!workspace) throw new Error('Workspace not found');

  const settings = await resolveLifecycleScriptForWorkspace(workspace, type);
  return { workspace, ...settings };
}

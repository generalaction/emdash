import { ok, type Result } from '@emdash/shared';
import { runLifecycleScriptWithPolicy } from './lifecycle-script-coordinator';
import {
  resolveLifecycleScript,
  type LifecycleScriptSettingsError,
} from './lifecycle-script-settings';

export async function runLifecycleScript({
  projectId,
  taskId,
  workspaceId,
  type,
}: {
  projectId: string;
  taskId: string;
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
  await runLifecycleScriptWithPolicy({
    workspace,
    projectId,
    taskId,
    workspaceId,
    type,
    script,
    shellSetup,
    origin: 'manual',
    policy: {
      respawnAfterExit: true,
      logFailure: true,
      surfaceFailure: true,
      continueOnFailure: false,
    },
    logPrefix: 'TerminalsController',
  });
  return ok();
}

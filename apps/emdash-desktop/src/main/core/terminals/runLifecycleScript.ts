import { runLifecycleScriptWithPolicy } from './lifecycle-script-coordinator';
import { resolveLifecycleScript } from './lifecycle-script-settings';

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
}) {
  const { workspace, script, shellSetup } = await resolveLifecycleScript({
    projectId,
    workspaceId,
    type,
  });
  if (!script) return;
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
}

import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import type { MachineRef } from '@main/core/runtime/types';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { buildTaskFromWorkspace, emitTaskProvisionProgress } from '@main/core/tasks/task-builder';
import { resolveBYOISshConnectConfig } from '@main/core/workspaces/byoi/byoi-ssh-connect-config';
import { parseProvisionOutput } from '@main/core/workspaces/byoi/provision-output';
import type { WorkspaceBootstrapResult } from '@main/core/workspaces/workspace-bootstrap-service';
import {
  createWorkspaceFactory,
  type WorkspaceType,
} from '@main/core/workspaces/workspace-factory';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { ProjectSettings } from '@shared/core/project-settings/project-settings';
import type { Task } from '@shared/core/tasks/tasks';

export type ProvisionBYOITaskParams = {
  task: Task;
  /** Workspace provider config read from project settings (`workspaceProvider.type === 'script'`). */
  wpConfig: NonNullable<ProjectSettings['workspaceProvider']>;
  /** Execution context for running provision/terminate scripts. */
  ctx: IExecutionContext;
  projectId: string;
  projectPath: string;
  settings: ProjectSettingsProvider;
  logPrefix: string;
  /** UUID from the workspaces table — used as the workspace registry key. */
  workspaceId: string;
};

/**
 * Runs the BYOI script-run → SSH-connect → workspace-acquire → build flow.
 * Parameterised by `execFn` so both local and SSH project providers can use it:
 * - Local project: pass `new LocalExecutionContext({ root: projectPath })` (scripts run on local machine)
 * - SSH project:  pass `new SshExecutionContext(proxy, { root: projectPath })` (scripts run on remote host)
 */
export async function provisionBYOITask(
  params: ProvisionBYOITaskParams
): Promise<WorkspaceBootstrapResult> {
  const { task, wpConfig, ctx, projectId, projectPath, settings, logPrefix } = params;

  emitTaskProvisionProgress({
    taskId: task.id,
    projectId,
    step: 'running-provision-script',
    message: 'Running provision script…',
  });

  const { stdout } = await ctx.exec('/bin/sh', ['-c', wpConfig.provisionCommand]);

  const parseResult = parseProvisionOutput(stdout);
  if (!parseResult.success) {
    throw new Error(parseResult.error.message);
  }
  const output = parseResult.data;

  emitTaskProvisionProgress({
    taskId: task.id,
    projectId,
    step: 'connecting',
    message: `Connecting to ${output.host}…`,
  });

  const connectionId = `task:${task.id}`;
  const proxy = await sshConnectionManager.connectFromConfig(
    connectionId,
    resolveBYOISshConnectConfig(output)
  );

  emitTaskProvisionProgress({
    taskId: task.id,
    projectId,
    step: 'setting-up-workspace',
    message: 'Setting up workspace…',
  });

  const workDir = output.worktreePath ?? projectPath;
  const { workspaceId } = params;
  const workspaceType: WorkspaceType = { kind: 'ssh', proxy, connectionId };
  const workspaceMachine: MachineRef = { kind: 'ssh', connectionId };

  const workspace = await workspaceRegistry.acquire(
    workspaceId,
    projectId,
    createWorkspaceFactory(workspaceId, workspaceType, {
      task,
      workDir,
      projectId,
      projectPath,
      workspaceRuntime: {
        machine: workspaceMachine,
        manager: runtimeManager,
      },
      settings,
      logPrefix,
      extraHooks: {
        onDestroy: async () => {
          const cmd = output.id
            ? `REMOTE_WORKSPACE_ID=${quoteShellArg(output.id)} ${wpConfig.terminateCommand}`
            : wpConfig.terminateCommand;
          await ctx.exec('/bin/sh', ['-c', cmd]).catch((e) => {
            log.warn(`${logPrefix}: terminate command failed`, { error: String(e) });
          });
          await sshConnectionManager.disconnect(connectionId);
        },
        onDetach: async () => {
          await sshConnectionManager.disconnect(connectionId);
        },
      },
    })
  );

  let provisionSucceeded = false;
  try {
    emitTaskProvisionProgress({
      taskId: task.id,
      projectId,
      step: 'starting-sessions',
      message: 'Preparing task…',
    });
    const { taskProvider } = await buildTaskFromWorkspace(
      task,
      workspace,
      workspaceType,
      projectId,
      projectPath,
      settings
    );
    log.debug(`${logPrefix}: provisionBYOITask DONE`, { taskId: task.id });
    provisionSucceeded = true;
    return {
      path: workDir,
      workspaceId: workspace.id,
      sshConnectionId: connectionId,
      taskProvider,
      workspaceProviderData: { ...wpConfig, remoteWorkspaceId: output.id },
    };
  } finally {
    if (!provisionSucceeded) {
      await workspaceRegistry.release(workspace.id, 'terminate').catch(() => {});
    }
  }
}

import type { Conversation } from '@shared/conversations';
import { taskProvisionProgressChannel } from '@shared/events/taskEvents';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProvisionResult } from '@main/core/projects/project-provider';
import type { ProjectSettings, ProjectSettingsProvider } from '@main/core/projects/settings/schema';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { buildTaskFromWorkspace } from '@main/core/tasks/task-builder';
import { parseProvisionOutput } from '@main/core/workspaces/byoi/provision-output';
import { createWorkspaceFactory } from '@main/core/workspaces/workspace-factory';
import { remoteTaskWorkspaceId } from '@main/core/workspaces/workspace-id';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';

export type ProvisionBYOITaskParams = {
  task: Task;
  conversations: Conversation[];
  terminals: Terminal[];
  /** Workspace provider config read from project settings (`workspaceProvider.type === 'script'`). */
  wpConfig: NonNullable<ProjectSettings['workspaceProvider']>;
  /** Execution context for running provision/terminate scripts. */
  ctx: IExecutionContext;
  projectId: string;
  projectPath: string;
  settings: ProjectSettingsProvider;
  logPrefix: string;
};

/**
 * Runs the BYOI script-run → SSH-connect → workspace-acquire → build flow.
 * Parameterised by `execFn` so both local and SSH project providers can use it:
 * - Local project: pass `new LocalExecutionContext({ root: projectPath })` (scripts run on local machine)
 * - SSH project:  pass `new SshExecutionContext(proxy, { root: projectPath })` (scripts run on remote host)
 */
export async function provisionBYOITask(params: ProvisionBYOITaskParams): Promise<ProvisionResult> {
  const {
    task,
    conversations,
    terminals,
    wpConfig,
    ctx,
    projectId,
    projectPath,
    settings,
    logPrefix,
  } = params;

  events.emit(taskProvisionProgressChannel, {
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

  events.emit(taskProvisionProgressChannel, {
    taskId: task.id,
    projectId,
    step: 'connecting',
    message: `Connecting to ${output.host}…`,
  });

  const connectionId = `task:${task.id}`;
  const proxy = await sshConnectionManager.connectFromConfig(connectionId, {
    host: output.host,
    port: output.port ?? 22,
    username: output.username ?? process.env['USER'],
    ...(output.password ? { password: output.password } : { agent: process.env['SSH_AUTH_SOCK'] }),
  });

  events.emit(taskProvisionProgressChannel, {
    taskId: task.id,
    projectId,
    step: 'setting-up-workspace',
    message: 'Setting up workspace…',
  });

  const workDir = output.worktreePath ?? projectPath;
  const workspaceId = remoteTaskWorkspaceId(output.id ?? task.id);

  const workspace = await workspaceRegistry.acquire(
    workspaceId,
    projectId,
    createWorkspaceFactory(
      workspaceId,
      { kind: 'ssh', proxy, connectionId },
      {
        task,
        workDir,
        projectId,
        projectPath,
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
      }
    )
  );

  let provisionSucceeded = false;
  try {
    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId,
      step: 'starting-sessions',
      message: 'Starting sessions…',
    });
    const { taskProvider } = await buildTaskFromWorkspace(
      task,
      workspace,
      { kind: 'ssh', proxy, connectionId },
      projectId,
      projectPath,
      settings,
      { conversations, terminals },
      logPrefix
    );
    log.debug(`${logPrefix}: provisionBYOITask DONE`, { taskId: task.id });
    provisionSucceeded = true;
    return {
      taskProvider,
      persistData: {
        workspaceId: workspace.id,
        workspaceProviderData: { ...wpConfig, remoteWorkspaceId: output.id },
        sshConnectionId: connectionId,
      },
    };
  } finally {
    if (!provisionSucceeded) {
      await workspaceRegistry.release(workspace.id, 'terminate').catch(() => {});
    }
  }
}

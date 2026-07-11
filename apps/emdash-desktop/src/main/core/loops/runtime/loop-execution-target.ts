import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import {
  resolveTaskWorkspaceTarget,
  type TaskWorkspaceTargetError,
} from '@main/core/workspaces/resolve-task-workspace-target';
import { getTaskEnvVars } from '@main/core/workspaces/workspace-env';
import { err, ok, type Result } from '@main/lib/result';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';

export type LoopTaskEnvironment = {
  taskName: string;
  projectPath: string;
  defaultBranch?: string;
};

export type LoopExecutionTarget = LoopSessionTarget & {
  executionContext: IExecutionContext;
  taskEnv: Readonly<Record<string, string>>;
  dispose(): void;
};

export type LoopExecutionTargetError =
  | TaskWorkspaceTargetError
  | { kind: 'execution-context-unavailable'; message: string };

export type LoopExecutionTargetDependencies = {
  resolveTaskWorkspaceTarget: typeof resolveTaskWorkspaceTarget;
  createLocalExecutionContext(root: string): IExecutionContext;
  createSshExecutionContext(connectionId: string, root: string): Promise<IExecutionContext>;
};

const defaultDependencies: LoopExecutionTargetDependencies = {
  resolveTaskWorkspaceTarget,
  createLocalExecutionContext: (root) => new LocalExecutionContext({ root }),
  createSshExecutionContext: async (connectionId, root) => {
    const proxy = await sshConnectionManager.connect(connectionId);
    return new SshExecutionContext(proxy, { connectionId, root });
  },
};

export async function resolveLoopExecutionTarget(
  taskId: string,
  taskEnvironment: LoopTaskEnvironment,
  dependencies: LoopExecutionTargetDependencies = defaultDependencies
): Promise<Result<LoopExecutionTarget, LoopExecutionTargetError>> {
  const resolved = await dependencies.resolveTaskWorkspaceTarget(taskId);
  if (!resolved.success) return err(resolved.error);

  const target = resolved.data;
  try {
    const executionContext =
      target.machine.kind === 'local'
        ? dependencies.createLocalExecutionContext(target.path)
        : await dependencies.createSshExecutionContext(target.machine.connectionId, target.path);
    const taskEnv = getTaskEnvVars({
      taskId,
      taskName: taskEnvironment.taskName,
      taskPath: target.path,
      projectPath: taskEnvironment.projectPath,
      defaultBranch: taskEnvironment.defaultBranch,
      portSeed: target.path,
    });

    return ok({
      ...target,
      executionContext,
      taskEnv,
      dispose: () => executionContext.dispose(),
    });
  } catch (error) {
    return err({
      kind: 'execution-context-unavailable',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

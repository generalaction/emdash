import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { terminalsContract } from '@emdash/core/runtimes/terminals/api';
import type { ActivateWorkspaceInput } from '@emdash/core/runtimes/workspace/api';
import type {
  ScriptNodeLifecycle,
  ScriptWorkflowProgress,
  ScriptWorkflowResult,
  TerminalError,
} from '@emdash/core/services/script-workflows/api';
import { err, ok, type Result } from '@emdash/shared';
import { createLiveJobReplica, LiveJobCancelledError, LiveJobFailedError } from '@emdash/wire';
import type { Task } from '@core/primitives/tasks/api';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { getTerminalsRuntimeClient } from '@main/gateway/accessors';
import { getTaskEnvVars } from './workspace-env';

export type ScriptWorkflowNodeInput = {
  id: 'setup' | 'run' | 'teardown';
  label: string;
  command: string;
  dependsOn?: string[];
  lifecycle?: ScriptNodeLifecycle;
};

export type TriggerTaskScriptWorkflowInput = {
  task: Task;
  project: ProjectProvider;
  workspaceId: string;
  workspace: HostFileRef;
  cwd: string;
  kind: string;
  shellSetup?: string;
  nodes: ScriptWorkflowNodeInput[];
  signal?: AbortSignal;
  onProgress?: (progress: ScriptWorkflowProgress) => void;
};

export async function triggerTaskScriptWorkflow(
  input: TriggerTaskScriptWorkflowInput
): Promise<Result<ScriptWorkflowResult, TerminalError>> {
  const terminals = await getTerminalsRuntimeClient();
  const defaultBranch = await input.project.settings.getDefaultBranch();
  const env = {
    ...stringEnv(process.env),
    ...getTaskEnvVars({
      taskId: input.task.id,
      taskName: input.task.name,
      taskPath: input.cwd,
      projectPath: input.project.repoPath,
      defaultBranch,
      portSeed: input.cwd,
    }),
  };
  const jobs = createLiveJobReplica(terminalsContract.runWorkflow, terminals.runWorkflow);
  const lease = await jobs.start({
    workspace: input.workspace,
    kind: input.kind,
    nodes: input.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      command: node.command,
      shellSetup: input.shellSetup,
      cwd: input.cwd,
      env,
      dependsOn: node.dependsOn,
      lifecycle: node.lifecycle,
    })),
  });
  const job = await lease.ready();
  const unsubscribe = job.onProgress((progress) => input.onProgress?.(progress));
  const cancel = () => void job.cancel();
  input.signal?.addEventListener('abort', cancel, { once: true });

  try {
    return ok(await job.result);
  } catch (error) {
    return err(liveJobErrorToTerminalError(error));
  } finally {
    input.signal?.removeEventListener('abort', cancel);
    unsubscribe();
    await lease.release();
    await jobs.dispose();
  }
}

export function postActivationWorkflowNodes(
  automation: ActivateWorkspaceInput['automation']
): ScriptWorkflowNodeInput[] {
  if (!automation) return [];
  const nodes: ScriptWorkflowNodeInput[] = [];
  if (automation.setup && automation.autoRunSetup) {
    nodes.push({ id: 'setup', label: 'Setup', command: automation.setup });
  }
  if (automation.run && automation.autoRunRun) {
    nodes.push({
      id: 'run',
      label: 'Run',
      command: automation.run,
      dependsOn: nodes.some((node) => node.id === 'setup') ? ['setup'] : undefined,
      lifecycle: 'background',
    });
  }
  return nodes;
}

export function teardownWorkflowNodes(
  automation: ActivateWorkspaceInput['automation']
): ScriptWorkflowNodeInput[] {
  if (!automation?.teardown) return [];
  return [{ id: 'teardown', label: 'Teardown', command: automation.teardown }];
}

function liveJobErrorToTerminalError(error: unknown): TerminalError {
  if (error instanceof LiveJobFailedError) {
    return error.error ?? { type: 'terminal-workflow-failed', message: 'Terminal workflow failed' };
  }
  if (error instanceof LiveJobCancelledError) {
    return { type: 'cancelled', message: 'Terminal workflow was cancelled' };
  }
  return {
    type: 'terminal-workflow-error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

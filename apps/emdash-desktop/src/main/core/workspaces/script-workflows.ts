import type { HostFileRef } from '@emdash/core/primitives/path/api';
import {
  terminalsContract,
  type ScriptWorkflowProgress,
  type ScriptWorkflowResult,
  type TerminalError,
} from '@emdash/core/runtimes/terminals/api';
import type { ActivateWorkspaceInput } from '@emdash/core/runtimes/workspace/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Unsubscribe } from '@emdash/shared';
import { createLiveJobReplica, LiveJobCancelledError, LiveJobFailedError } from '@emdash/wire';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { wireTerminalUrlDetector } from '@main/core/preview-servers/terminal-url-detector';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { getTerminalsRuntimeClient } from '@main/core/wire-workers/accessors';
import type { Task } from '@shared/core/tasks/tasks';
import { getTaskEnvVars } from './workspace-env';

export type ScriptWorkflowNodeInput = {
  id: 'setup' | 'run' | 'teardown';
  label: string;
  command: string;
  dependsOn?: string[];
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
  const stopPreviewDetection = input.nodes.some((node) => node.id === 'run')
    ? wirePreviewDetection({
        projectId: input.project.projectId,
        workspaceId: input.workspaceId,
        terminals,
        workspace: input.workspace,
      })
    : undefined;
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
    stopPreviewDetection?.();
    unsubscribe();
    await lease.release();
    await jobs.dispose();
  }
}

function wirePreviewDetection({
  projectId,
  workspaceId,
  terminals,
  workspace,
}: {
  projectId: string;
  workspaceId: string;
  terminals: Awaited<ReturnType<typeof getTerminalsRuntimeClient>>;
  workspace: HostFileRef;
}): () => void {
  const pty = liveLogBackedPty(terminals.output.handle({ workspace, id: 'run' }).asLiveSource());
  wireTerminalUrlDetector({
    pty,
    probeLocalPorts: true,
    onDetected: (server) => {
      void previewServerService.registerDetectedTarget({
        projectId,
        workspaceId,
        transport: 'local',
        source: { kind: 'terminal-output', terminalId: 'run' },
        protocol: server.protocol,
        host: server.host,
        port: server.port,
        urlPath: server.urlPath,
      });
    },
    onSourceClosed: (event) =>
      previewServerService.handleTerminalSourceClosed({
        projectId,
        workspaceId,
        terminalId: 'run',
        transport: 'local',
        reason: event.reason,
        server: event.reason === 'local-probe-failed' ? event.server : undefined,
      }),
  });
  return () => pty.close({ exitCode: 0 });
}

function liveLogBackedPty(source: {
  subscribe(cb: (update: { delta?: unknown }) => void): Unsubscribe | Promise<Unsubscribe>;
}): Pty & { close(info: PtyExitInfo): void } {
  const dataHandlers: Array<(data: string) => void> = [];
  const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  let closed = false;
  let unsubscribe: Unsubscribe | undefined;
  void Promise.resolve(
    source.subscribe((update) => {
      if (closed) return;
      const chunk =
        typeof update.delta === 'object' &&
        update.delta !== null &&
        typeof (update.delta as { chunk?: unknown }).chunk === 'string'
          ? (update.delta as { chunk: string }).chunk
          : undefined;
      if (!chunk) return;
      for (const handler of dataHandlers) handler(chunk);
    })
  ).then((resolved) => {
    if (closed) {
      resolved();
      return;
    }
    unsubscribe = resolved;
  });
  const pty: Pty & { close(info: PtyExitInfo): void } = {
    write() {},
    resize() {},
    kill() {
      pty.close({ signal: 'SIGTERM' });
    },
    onData(handler) {
      dataHandlers.push(handler);
    },
    onExit(handler) {
      exitHandlers.push(handler);
    },
    close(info) {
      closed = true;
      unsubscribe?.();
      for (const handler of exitHandlers) handler(info);
    },
  };
  return pty;
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

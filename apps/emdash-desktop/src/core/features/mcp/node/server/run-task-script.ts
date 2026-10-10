import type { LifecycleScriptType } from '@core/primitives/tasks/api';
import type { McpToolDependencies } from './dependencies';
import { resolveTaskWorkspaceId, resolveWorkspaceRuntime } from './workspace-runtime';

export type TaskScriptInput = {
  projectId: string;
  taskId: string;
  type: LifecycleScriptType;
};

export type TaskScriptResult =
  | { status: 'not_found'; message: string }
  | { status: 'started'; taskId: string; type: LifecycleScriptType }
  | { status: 'already_running'; taskId: string; type: LifecycleScriptType }
  | { status: 'no_script'; taskId: string; type: LifecycleScriptType; message: string }
  | { status: 'stopped'; taskId: string; type: LifecycleScriptType }
  | { status: 'not_running'; taskId: string; type: LifecycleScriptType }
  | { status: 'failed'; taskId: string; type: LifecycleScriptType; message: string };

/**
 * Starts one of a task's worktree lifecycle scripts through the same host
 * registry verb the Scripts panel uses, and returns as soon as it has started.
 */
export async function runTaskScript(
  dependencies: McpToolDependencies,
  input: TaskScriptInput
): Promise<TaskScriptResult> {
  const resolved = await resolveTaskWorkspaceId(dependencies, input);
  if (!resolved.success) return { status: 'not_found', message: resolved.error };

  const runtime = await resolveWorkspaceRuntime(dependencies, resolved.data);
  if (!runtime.success) return { status: 'not_found', message: runtime.error };

  const started = await runtime.data.client.workspaceRegistry.runScript({
    workspaceId: resolved.data,
    script: input.type,
    provenance: 'manual',
  });
  if (started.success) {
    return { status: 'started', taskId: input.taskId, type: input.type };
  }
  // The host distinguishes "nothing configured" from "already going"; both are
  // ordinary outcomes for a caller polling the Scripts panel, not errors.
  if (started.error.type === 'script-not-configured') {
    return {
      status: 'no_script',
      taskId: input.taskId,
      type: input.type,
      message: `No ${input.type} script is configured for this project`,
    };
  }
  if (started.error.type === 'run-in-flight') {
    return { status: 'already_running', taskId: input.taskId, type: input.type };
  }
  return {
    status: 'failed',
    taskId: input.taskId,
    type: input.type,
    message: scriptErrorMessage(started.error),
  };
}

/** Stops a task's running lifecycle script, as the Scripts panel's Stop does. */
export async function stopTaskScript(
  dependencies: McpToolDependencies,
  input: TaskScriptInput
): Promise<TaskScriptResult> {
  const resolved = await resolveTaskWorkspaceId(dependencies, input);
  if (!resolved.success) return { status: 'not_found', message: resolved.error };

  const runtime = await resolveWorkspaceRuntime(dependencies, resolved.data);
  if (!runtime.success) return { status: 'not_found', message: runtime.error };

  const stopped = await runtime.data.client.scripts.stop({
    workspacePath: runtime.data.path,
    script: input.type,
  });
  if (stopped.success) return { status: 'stopped', taskId: input.taskId, type: input.type };
  if (stopped.error.type === 'not-found') {
    return { status: 'not_running', taskId: input.taskId, type: input.type };
  }
  return {
    status: 'failed',
    taskId: input.taskId,
    type: input.type,
    message: scriptErrorMessage(stopped.error),
  };
}

function scriptErrorMessage(error: { type: string; message?: string }): string {
  return error.message ?? error.type;
}

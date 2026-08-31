import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { and, eq, isNull } from 'drizzle-orm';
import type { LifecycleScriptType } from '@core/primitives/tasks/api';
import { tasks } from '@core/services/app-db/node/schema';
import type { McpToolDependencies } from './dependencies';

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

async function resolveWorkspaceId(
  dependencies: McpToolDependencies,
  input: TaskScriptInput
): Promise<{ workspaceId: string } | { message: string }> {
  const [row] = await dependencies.db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(
      and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId), isNull(tasks.deletedAt))
    )
    .limit(1);
  if (!row) return { message: `Task not found in project ${input.projectId}: ${input.taskId}` };
  if (!row.workspaceId) {
    return { message: `Task ${input.taskId} has no workspace yet, so it has no scripts to run` };
  }
  return { workspaceId: row.workspaceId };
}

/**
 * Starts one of a task's worktree lifecycle scripts through the same host
 * registry verb the Scripts panel uses, and returns as soon as it has started.
 */
export async function runTaskScript(
  dependencies: McpToolDependencies,
  input: TaskScriptInput
): Promise<TaskScriptResult> {
  const resolved = await resolveWorkspaceId(dependencies, input);
  if ('message' in resolved) return { status: 'not_found', message: resolved.message };

  const runtime = await runtimeForWorkspace(dependencies, resolved.workspaceId);
  if ('message' in runtime) return { status: 'not_found', message: runtime.message };

  const started = await runtime.client.workspaceRegistry.runScript({
    workspaceId: resolved.workspaceId,
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
  const resolved = await resolveWorkspaceId(dependencies, input);
  if ('message' in resolved) return { status: 'not_found', message: resolved.message };

  const runtime = await runtimeForWorkspace(dependencies, resolved.workspaceId);
  if ('message' in runtime) return { status: 'not_found', message: runtime.message };

  const stopped = await runtime.client.scripts.stop({
    workspacePath: runtime.path,
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

type ResolvedRuntime = { message: string } | { client: HostRuntimesClient; path: string };

async function runtimeForWorkspace(
  dependencies: McpToolDependencies,
  workspaceId: string
): Promise<ResolvedRuntime> {
  const identity = await dependencies.workspaceIdentity.resolve(workspaceId);
  if (!identity) return { message: `Workspace ${workspaceId} is no longer known` };
  const client = await dependencies.runtimes.client(identity.host);
  if (!client.success) {
    return { message: `The task's host is unavailable (${client.error.type})` };
  }
  return { client: client.data, path: identity.path };
}

function scriptErrorMessage(error: { type: string; message?: string }): string {
  return error.message ?? error.type;
}

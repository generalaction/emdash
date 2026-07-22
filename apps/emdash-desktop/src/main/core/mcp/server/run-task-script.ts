import { and, eq } from 'drizzle-orm';
import {
  isLifecycleScriptSessionActive,
  runLifecycleScriptWithPolicy,
  stopLifecycleScriptSession,
} from '@main/core/terminals/lifecycle-script-coordinator';
import { resolveLifecycleScript } from '@main/core/terminals/lifecycle-script-settings';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { LifecycleScriptType } from '@shared/core/tasks/taskEvents';
import { ensureProjectOpen } from './create-task-from-prompt';

export type RunTaskScriptInput = {
  projectId: string;
  taskId: string;
  type: LifecycleScriptType;
};

export type StopTaskScriptInput = {
  projectId: string;
  taskId: string;
  type: LifecycleScriptType;
};

export type StopTaskScriptResult =
  | { status: 'not_found'; message: string }
  | { status: 'stopped'; type: LifecycleScriptType }
  | { status: 'not_running'; type: LifecycleScriptType };

type ResolveTaskWorkspaceResult =
  | { ok: true; workspaceId: string }
  | { ok: false; message: string };

/**
 * Looks up a task's `workspaceId` from the db, scoped to its project.
 * `openProject` mounts the project's workspace registry (needed before
 * resolving a live workspace); stopping a script does not need it, since
 * stopLifecycleScriptSession works off the PTY registry by id alone — so
 * callers opt in rather than mounting a whole project as a side effect.
 */
async function resolveTaskWorkspace(
  projectId: string,
  taskId: string,
  { openProject }: { openProject: boolean }
): Promise<ResolveTaskWorkspaceResult> {
  const [taskRow] = await db
    .select({ id: tasks.id, workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!taskRow) {
    return { ok: false, message: `Task not found in project ${projectId}: ${taskId}` };
  }
  if (!taskRow.workspaceId) {
    return {
      ok: false,
      message: `Task ${taskId} has no workspace; its worktree may not be provisioned yet.`,
    };
  }

  if (openProject) {
    const project = await ensureProjectOpen(projectId);
    if (!project) {
      return { ok: false, message: `Project ${projectId} could not be opened` };
    }
  }
  return { ok: true, workspaceId: taskRow.workspaceId };
}

export type RunTaskScriptResult =
  | { status: 'not_found'; message: string }
  | { status: 'no_script'; type: LifecycleScriptType }
  | { status: 'started'; type: LifecycleScriptType }
  | { status: 'already_running'; type: LifecycleScriptType };

/**
 * Starts one of a task's configured lifecycle scripts (`setup`, `run`, or
 * `teardown`) and returns as soon as it has started, rather than waiting for it
 * to finish. A caller that wants to know when a script has completed watches the
 * Scripts panel / status events, and stops a still-running one with
 * stopTaskScript. This drives the same PTY session and status events as the
 * Scripts panel in the UI, so the run is visible there regardless of who
 * started it.
 */
export async function runTaskScript(input: RunTaskScriptInput): Promise<RunTaskScriptResult> {
  const { projectId, taskId, type } = input;

  // Running a script resolves a live workspace, so the project must be mounted.
  const resolvedWorkspace = await resolveTaskWorkspace(projectId, taskId, { openProject: true });
  if (!resolvedWorkspace.ok) {
    return { status: 'not_found', message: resolvedWorkspace.message };
  }
  const { workspaceId } = resolvedWorkspace;

  const resolved = await resolveLifecycleScript({ projectId, workspaceId, type });
  if (!resolved.success) {
    const detail =
      resolved.error.type === 'not_found'
        ? `workspace ${resolved.error.workspaceId} is not mounted`
        : resolved.error.message;
    return { status: 'not_found', message: `Could not resolve ${type} script: ${detail}` };
  }

  const { workspace, script, shellSetup } = resolved.data;
  if (!script) {
    return { status: 'no_script', type };
  }

  // Already running (e.g. auto-run on provision, or an earlier call): the
  // fire-and-forget below discards the coordinator's synchronous
  // 'already-running' result, so without this check we'd report 'started' when
  // nothing new started. Mirrors the UI's isRunning guard.
  if (isLifecycleScriptSessionActive({ projectId, workspaceId, type })) {
    return { status: 'already_running', type };
  }

  // Start and return without awaiting completion: setup/teardown may finish
  // quickly, run (a dev server) is expected to stay up, and a caller should not
  // block on either. The coordinator emits 'running' synchronously before the
  // first await, so the Scripts panel reflects it once this returns.
  void runLifecycleScriptWithPolicy({
    workspace,
    projectId,
    taskId,
    workspaceId,
    type,
    script,
    shellSetup,
    origin: 'manual',
    policy: {
      // Keep the shell alive after the command so a dev server stays up and a
      // finished setup/teardown can respawn from the Scripts panel.
      respawnAfterExit: true,
      logFailure: true,
      surfaceFailure: true,
      // The caller has already returned; fail via logs/status, never throw
      // into an unhandled rejection.
      continueOnFailure: true,
    },
    logPrefix: 'McpHttpServer',
  }).catch((error) => {
    log.error(`McpHttpServer: ${type} script failed`, { error: String(error) });
  });
  return { status: 'started', type };
}

/**
 * Stops a running lifecycle script session, mirroring the UI's Stop button.
 * Any type (`setup`, `run`, or `teardown`) can be stopped, since runTaskScript
 * starts them without waiting and a slow one may still be running. Emits the
 * same `stopped` status event as the UI, so the Scripts panel updates live.
 */
export async function stopTaskScript(input: StopTaskScriptInput): Promise<StopTaskScriptResult> {
  const { projectId, taskId, type } = input;

  // Stopping works off the PTY registry by session id, so it doesn't need the
  // project mounted; avoid opening one as a side effect of a stop.
  const resolvedWorkspace = await resolveTaskWorkspace(projectId, taskId, { openProject: false });
  if (!resolvedWorkspace.ok) {
    return { status: 'not_found', message: resolvedWorkspace.message };
  }
  const { workspaceId } = resolvedWorkspace;

  const stopped = stopLifecycleScriptSession({
    projectId,
    taskId,
    workspaceId,
    type,
    origin: 'manual',
  });
  // stopLifecycleScriptSession returns false when there is no active,
  // not-already-stopped session for this type; from the caller's view that all
  // reduces to "there was nothing running to stop".
  return stopped ? { status: 'stopped', type } : { status: 'not_running', type };
}

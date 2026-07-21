import { err, ok, type Result } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import {
  hasCompletedTaskLifecycleTeardown,
  hasCompletedTaskProviderDestroy,
  markTaskLifecycleTeardownCompleted,
  markTaskProviderDestroyCompleted,
} from '@main/core/tasks/task-resource-teardown-state';
import {
  cleanupDetachedTaskSessions,
  taskSessionManager,
  type TaskTeardownMode,
} from '@main/core/tasks/task-session-manager';
import { teardownStoredWorkspace } from '@main/core/workspaces/teardown-stored-workspace';
import { db } from '@main/db/client';
import { workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { TeardownTaskError } from '../provision-task-error';

type StoredTask = {
  id: string;
  projectId: string;
  name: string;
  workspaceId: string | null;
  lifecycleTeardownAt?: string | null;
  providerDestroyAt?: string | null;
};

type ResourceTeardownMode = Extract<TaskTeardownMode, 'archive' | 'terminate'>;

type InFlightTeardown = {
  mode: ResourceTeardownMode;
  promise: Promise<Result<void, TeardownTaskError>>;
};

const teardownsInFlight = new Map<string, InFlightTeardown>();

async function performTaskResourceTeardown(
  task: StoredTask,
  mode: ResourceTeardownMode
): Promise<Result<void, TeardownTaskError>> {
  const liveTask = taskSessionManager.getTask(task.id);
  if (liveTask) {
    const result = await taskSessionManager.teardownTask(task.id, mode);
    if (result.success) {
      if (mode === 'archive') markTaskLifecycleTeardownCompleted(task.id);
      else markTaskProviderDestroyCompleted(task.id);
    }
    return result;
  }

  const lifecycleTeardownCompleted =
    hasCompletedTaskLifecycleTeardown(task.id) || task.lifecycleTeardownAt != null;
  if (mode === 'archive' && lifecycleTeardownCompleted) return ok<void>();
  if (
    mode === 'terminate' &&
    (hasCompletedTaskProviderDestroy(task.id) || task.providerDestroyAt != null)
  ) {
    return ok<void>();
  }

  // A task that never acquired a workspace has no workspace lifecycle hook to run.
  if (!task.workspaceId) {
    if (mode === 'archive') markTaskLifecycleTeardownCompleted(task.id);
    else markTaskProviderDestroyCompleted(task.id);
    return ok<void>();
  }

  const project = projectManager.getProject(task.projectId);
  if (!project) {
    return err({
      type: 'error',
      message: `Cannot safely teardown task ${task.id}: project ${task.projectId} is not mounted.`,
    });
  }

  await cleanupDetachedTaskSessions(task.projectId, task.id, project.ctx).catch((error) => {
    log.warn('teardownTaskResources: detached session cleanup failed', {
      taskId: task.id,
      error: String(error),
    });
  });

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, task.workspaceId))
    .limit(1);
  if (!workspace) {
    return err({
      type: 'error',
      message: `Cannot safely teardown task ${task.id}: workspace ${task.workspaceId} was not found.`,
    });
  }

  const workspaceMode =
    mode === 'terminate' && lifecycleTeardownCompleted ? 'terminate-provider' : mode;
  const result = await teardownStoredWorkspace({ task, workspace, project, mode: workspaceMode });
  if (!result.success) return result;
  if (mode === 'archive') markTaskLifecycleTeardownCompleted(task.id);
  else markTaskProviderDestroyCompleted(task.id);
  return ok<void>();
}

function trackTeardown(
  task: StoredTask,
  mode: ResourceTeardownMode,
  promise: Promise<Result<void, TeardownTaskError>>
): Promise<Result<void, TeardownTaskError>> {
  const trackedPromise = promise.finally(() => {
    if (teardownsInFlight.get(task.id)?.promise === trackedPromise) {
      teardownsInFlight.delete(task.id);
    }
  });
  teardownsInFlight.set(task.id, { mode, promise: trackedPromise });
  return trackedPromise;
}

/**
 * Tears down both live and cold task resources. Cold tasks are absent from the in-memory
 * session manager after archive or app restart, so their persisted workspace must be
 * reopened in teardown-only mode before its path is removed.
 */
export async function teardownTaskResources(
  task: StoredTask,
  mode: ResourceTeardownMode
): Promise<Result<void, TeardownTaskError>> {
  const inFlight = teardownsInFlight.get(task.id);
  if (!inFlight) {
    return trackTeardown(task, mode, performTaskResourceTeardown(task, mode));
  }

  // Termination subsumes archive cleanup. Conversely, a terminate request must wait for an
  // in-flight archive and then run so provider-specific destroy hooks are never suppressed.
  if (inFlight.mode === mode || inFlight.mode === 'terminate') return inFlight.promise;

  const terminateAfterArchive = inFlight.promise.then(
    () => performTaskResourceTeardown(task, 'terminate'),
    () => performTaskResourceTeardown(task, 'terminate')
  );
  return trackTeardown(task, 'terminate', terminateAfterArchive);
}

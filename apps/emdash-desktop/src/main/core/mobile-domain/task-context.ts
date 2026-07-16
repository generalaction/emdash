import { and, eq, isNull } from 'drizzle-orm';
import { openProject } from '@main/core/projects/operations/openProject';
import { taskService } from '@main/core/tasks/task-service';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import type { ProvisionWorkspaceError } from '@shared/core/tasks/tasks';

const taskReadiness = new Map<string, Promise<void>>();

export async function getReadyTaskContext(taskId: string) {
  const [task] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      workspaceId: tasks.workspaceId,
      name: tasks.name,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.archivedAt)))
    .limit(1);
  if (!task) throw new Error('Task not found');

  await ensureTaskReady(task.id, task.projectId);
  const workspaceId = taskSessionManager.getWorkspaceId(taskId) ?? task.workspaceId;
  if (!workspaceId) throw new Error('Task workspace is not ready');
  const workspace = workspaceRegistry.get(workspaceId);
  if (!workspace) throw new Error('Task workspace is not ready');
  return { task, workspaceId, workspace, persistData: taskSessionManager.getPersistData(taskId) };
}

async function ensureTaskReady(taskId: string, projectId: string): Promise<void> {
  const bootstrap = taskSessionManager.getBootstrapStatus(taskId);
  if (bootstrap.status === 'ready') return;
  if (bootstrap.status === 'error') throw new Error(bootstrap.message);

  const existing = taskReadiness.get(taskId);
  if (existing) return await existing;

  const readiness = provisionTask(taskId, projectId).finally(() => {
    if (taskReadiness.get(taskId) === readiness) taskReadiness.delete(taskId);
  });
  taskReadiness.set(taskId, readiness);
  await readiness;
}

async function provisionTask(taskId: string, projectId: string): Promise<void> {
  const opened = await openProject(projectId);
  if (!opened.success) {
    const message =
      opened.error.type === 'path-not-found'
        ? 'Project path is unavailable'
        : opened.error.type === 'ssh-disconnected'
          ? 'Project SSH connection is disconnected'
          : opened.error.message;
    throw new Error(message);
  }

  const provisioned = await taskService.provisionWorkspace(taskId);
  if (!provisioned.success) throw new Error(provisionErrorMessage(provisioned.error));

  const bootstrap = taskSessionManager.getBootstrapStatus(taskId);
  if (bootstrap.status === 'ready') return;
  if (bootstrap.status === 'error') throw new Error(bootstrap.message);
  throw new Error('Task workspace is not ready');
}

function provisionErrorMessage(error: ProvisionWorkspaceError): string {
  if (error.type === 'no-intent') return 'Task workspace setup is unavailable';
  if (error.type === 'missing-workspace') return 'Task workspace configuration is missing';
  return error.message ?? `Task workspace setup failed during ${error.stepKind}`;
}

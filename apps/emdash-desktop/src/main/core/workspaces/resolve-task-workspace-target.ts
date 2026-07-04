import { access } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import type { MachineRef } from '@main/core/runtime/types';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { taskSessionManager } from '../tasks/task-session-manager';
import { workspaceRegistry } from './workspace-registry';

export type TaskWorkspaceTarget = {
  workspaceId: string;
  path: string;
  machine: MachineRef;
};

export type TaskWorkspaceTargetError =
  | { kind: 'task-not-found'; message: string }
  | { kind: 'workspace-unavailable'; message: string };

async function localPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function machineForWorkspace(row: {
  location: 'local' | 'remote' | null;
  sshConnectionId: string | null;
}): TaskWorkspaceTargetError | MachineRef {
  if (row.location === 'remote') {
    if (!row.sshConnectionId) {
      return {
        kind: 'workspace-unavailable',
        message: 'Workspace is remote but has no SSH connection',
      };
    }
    return { kind: 'ssh', connectionId: row.sshConnectionId };
  }
  return row.sshConnectionId
    ? { kind: 'ssh', connectionId: row.sshConnectionId }
    : { kind: 'local' };
}

export async function resolveTaskWorkspaceTarget(
  taskId: string
): Promise<
  { success: true; data: TaskWorkspaceTarget } | { success: false; error: TaskWorkspaceTargetError }
> {
  const activeWorkspaceId = taskSessionManager.getWorkspaceId(taskId);
  if (activeWorkspaceId) {
    const activeWorkspace = workspaceRegistry.get(activeWorkspaceId);
    if (activeWorkspace) {
      const connectionId = taskSessionManager.getPersistData(taskId)?.sshConnectionId;
      return {
        success: true,
        data: {
          workspaceId: activeWorkspaceId,
          path: activeWorkspace.path,
          machine: connectionId ? { kind: 'ssh', connectionId } : { kind: 'local' },
        },
      };
    }
  }

  const [taskRow] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!taskRow) {
    return { success: false, error: { kind: 'task-not-found', message: 'Task not found' } };
  }
  if (!taskRow.workspaceId) {
    return {
      success: false,
      error: { kind: 'workspace-unavailable', message: 'Task has no workspace' },
    };
  }

  const [workspaceRow] = await db
    .select({
      id: workspaces.id,
      path: workspaces.path,
      location: workspaces.location,
      sshConnectionId: workspaces.sshConnectionId,
    })
    .from(workspaces)
    .where(eq(workspaces.id, taskRow.workspaceId))
    .limit(1);

  if (!workspaceRow) {
    return {
      success: false,
      error: { kind: 'workspace-unavailable', message: 'Workspace row not found' },
    };
  }
  if (!workspaceRow.path) {
    return {
      success: false,
      error: { kind: 'workspace-unavailable', message: 'Workspace path is not available' },
    };
  }

  const machine = machineForWorkspace(workspaceRow);
  if ('message' in machine) return { success: false, error: machine };

  if (machine.kind === 'local' && !(await localPathExists(workspaceRow.path))) {
    return {
      success: false,
      error: {
        kind: 'workspace-unavailable',
        message: `Workspace path no longer exists: ${workspaceRow.path}`,
      },
    };
  }

  return {
    success: true,
    data: {
      workspaceId: workspaceRow.id,
      path: workspaceRow.path,
      machine,
    },
  };
}

import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import type { WorkspaceResolution } from '@shared/workspaces';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { mapWorktreeErrorToProvisionError } from '../tasks/provision-task-error';
import { computeWorkspaceKey } from './workspace-key';

async function resolveBootstrap(params: {
  projectId: string;
  taskId: string;
}): Promise<WorkspaceResolution> {
  const { projectId, taskId } = params;

  const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!taskRow) throw new Error(`Task not found: ${taskId}`);

  const provider = projectManager.getProject(projectId);
  if (!provider) throw new Error(`Project not found: ${projectId}`);

  const rawWorkspaceId = taskRow.workspaceId;
  let workspaceId: string;

  if (
    !rawWorkspaceId ||
    rawWorkspaceId.startsWith('local:') ||
    rawWorkspaceId.startsWith('ssh:') ||
    rawWorkspaceId.startsWith('remote:')
  ) {
    const newId = crypto.randomUUID();
    const workspaceType = ((): 'local' | 'project-ssh' | 'byoi' => {
      if (rawWorkspaceId?.startsWith('remote:') || taskRow.workspaceProvider === 'byoi')
        return 'byoi';
      if (rawWorkspaceId?.startsWith('ssh:') || provider.defaultWorkspaceType.kind === 'ssh')
        return 'project-ssh';
      return 'local';
    })();

    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id: newId,
        type: workspaceType,
      });
      await tx.update(tasks).set({ workspaceId: newId }).where(eq(tasks.id, taskId));
    });
    workspaceId = newId;
  } else {
    workspaceId = rawWorkspaceId;
  }

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  if (workspace.type === 'byoi') {
    return { kind: 'ready' };
  }

  const { worktreeService } = provider;
  const taskBranch = taskRow.taskBranch ?? null;

  if (workspace.path) {
    const pathExists = await worktreeService.existsAtAbsolutePath(workspace.path);
    if (pathExists) {
      return { kind: 'ready' };
    }

    if (!taskBranch) {
      return { kind: 'path_missing', previousPath: workspace.path, taskBranch: null };
    }

    const candidatePath = await worktreeService.findBranchAnywhere(taskBranch);
    if (candidatePath && candidatePath !== workspace.path) {
      return {
        kind: 'branch_elsewhere',
        taskBranch,
        candidatePath,
        previousPath: workspace.path,
      };
    }

    return { kind: 'path_missing', previousPath: workspace.path, taskBranch };
  }

  if (!taskBranch) {
    return { kind: 'needs_create' };
  }

  const candidatePath = await worktreeService.findBranchAnywhere(taskBranch);
  if (candidatePath) {
    return { kind: 'adopt', candidatePath };
  }

  return { kind: 'needs_create' };
}

async function adoptWorktree(params: {
  projectId: string;
  taskId: string;
  candidatePath: string;
}): Promise<void> {
  const { projectId, taskId, candidatePath } = params;

  const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!taskRow?.workspaceId) throw new Error(`Task or workspace not found: ${taskId}`);

  const provider = projectManager.getProject(projectId);
  if (!provider) throw new Error(`Project not found: ${projectId}`);

  const connectionId =
    provider.defaultWorkspaceType.kind === 'ssh'
      ? provider.defaultWorkspaceType.connectionId
      : undefined;

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, taskRow.workspaceId));
  if (!workspace) throw new Error(`Workspace not found: ${taskRow.workspaceId}`);

  const key =
    workspace.type !== 'byoi'
      ? computeWorkspaceKey(workspace.type, candidatePath, connectionId)
      : null;

  await db
    .update(workspaces)
    .set({ path: candidatePath, key, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(workspaces.id, workspace.id));
}

async function createWorktree(params: { projectId: string; taskId: string }): Promise<void> {
  const { projectId, taskId } = params;

  const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!taskRow?.workspaceId) throw new Error(`Task or workspace not found: ${taskId}`);

  const provider = projectManager.getProject(projectId);
  if (!provider) throw new Error(`Project not found: ${projectId}`);

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, taskRow.workspaceId));
  if (!workspace) throw new Error(`Workspace not found: ${taskRow.workspaceId}`);

  if (!taskRow.taskBranch) {
    throw new Error(`Task has no taskBranch — cannot create worktree: ${taskId}`);
  }

  const { worktreeService } = provider;
  let worktreePath: string;

  if (
    !taskRow.sourceBranch ||
    taskRow.taskBranch === (taskRow.sourceBranch as { branch?: string }).branch
  ) {
    const result = await worktreeService.checkoutExistingBranch(taskRow.taskBranch);
    if (!result.success) throw mapWorktreeErrorToProvisionError(taskRow.taskBranch, result.error);
    worktreePath = result.data;
  } else {
    const result = await worktreeService.checkoutBranchWorktree(
      taskRow.sourceBranch as Parameters<typeof worktreeService.checkoutBranchWorktree>[0],
      taskRow.taskBranch
    );
    if (!result.success) throw mapWorktreeErrorToProvisionError(taskRow.taskBranch, result.error);
    worktreePath = result.data;
  }

  const connectionId =
    provider.defaultWorkspaceType.kind === 'ssh'
      ? provider.defaultWorkspaceType.connectionId
      : undefined;

  const key =
    workspace.type !== 'byoi'
      ? computeWorkspaceKey(workspace.type, worktreePath, connectionId)
      : null;

  await db
    .update(workspaces)
    .set({ path: worktreePath, key, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(workspaces.id, workspace.id));
}

export const workspaceController = createRPCController({
  resolveBootstrap,
  adoptWorktree,
  createWorktree,
});

import {
  branchKernelResource,
  worktreeKernelResource,
  type BranchResourceRef,
  type WorktreeResourceRef,
} from '@emdash/core/primitives/kernel-resources/api';
import { defineResource, type ResourceClaim } from '@emdash/core/primitives/kernel/api';

export interface ProjectResourceRef {
  projectId: string;
}

export interface TaskResourceRef extends ProjectResourceRef {
  taskId: string;
}

export interface WorkspaceResourceRef extends ProjectResourceRef {
  workspaceId: string;
}

export interface AutomationResourceRef extends ProjectResourceRef {
  automationId: string;
}

export const projectKernelResource = defineResource<'project', ProjectResourceRef>({
  name: 'project',
  key: (ref) => `project:${encodeURIComponent(ref.projectId)}`,
});

export const taskKernelResource = defineResource<'task', TaskResourceRef>({
  name: 'task',
  key: (ref) => `task:${encodeURIComponent(ref.taskId)}`,
  parent: (ref) => ({ def: projectKernelResource, ref: { projectId: ref.projectId } }),
});

export const workspaceKernelResource = defineResource<'workspace', WorkspaceResourceRef>({
  name: 'workspace',
  key: (ref) => `workspace:${encodeURIComponent(ref.workspaceId)}`,
  parent: (ref) => ({ def: projectKernelResource, ref: { projectId: ref.projectId } }),
});

export const automationKernelResource = defineResource<'automation', AutomationResourceRef>({
  name: 'automation',
  key: (ref) => `automation:${encodeURIComponent(ref.automationId)}`,
  parent: (ref) => ({ def: projectKernelResource, ref: { projectId: ref.projectId } }),
});

export interface DeleteTaskClaimInput {
  projectId: string;
  taskId: string;
  workspaceId?: string | null;
  branch?: BranchResourceRef;
  worktree?: WorktreeResourceRef;
  workspaceShared: boolean;
}

export interface WorkspaceClaimInput {
  projectId?: string;
  workspaceId?: string;
  branch?: BranchResourceRef;
  worktree?: WorktreeResourceRef;
}

export function deleteTaskKernelClaims(input: DeleteTaskClaimInput): ResourceClaim[] {
  const claims = taskKernelResource.mutates({
    projectId: input.projectId,
    taskId: input.taskId,
  });
  if (input.workspaceShared) {
    return claims;
  }
  if (input.workspaceId) {
    claims.push(
      ...workspaceKernelResource.mutates({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
      })
    );
  }
  if (input.branch) {
    claims.push(...branchKernelResource.mutates(input.branch));
  }
  if (input.worktree) {
    claims.push(...worktreeKernelResource.mutates(input.worktree));
  }
  return dedupeClaims(claims);
}

export function workspaceKernelClaims(input: WorkspaceClaimInput): ResourceClaim[] {
  const claims: ResourceClaim[] = [];
  if (input.projectId && input.workspaceId) {
    claims.push(
      ...workspaceKernelResource.mutates({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
      })
    );
  }
  if (input.branch) {
    claims.push(...branchKernelResource.mutates(input.branch));
  }
  if (input.worktree) {
    claims.push(...worktreeKernelResource.mutates(input.worktree));
  }
  return dedupeClaims(claims);
}

export function projectClaimKey(projectId: string): string {
  return projectKernelResource.key({ projectId });
}

function dedupeClaims(claims: readonly ResourceClaim[]): ResourceClaim[] {
  const seen = new Set<string>();
  const result: ResourceClaim[] = [];
  for (const claim of claims) {
    const key = `${claim.resource}\u0000${claim.key}\u0000${claim.mode}\u0000${claim.implicit}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ ...claim });
  }
  return result;
}

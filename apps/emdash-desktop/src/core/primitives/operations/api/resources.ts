import { defineResource, type ResourceClaim } from '@emdash/core/primitives/kernel/api';
import { operationClaimResourceKey } from '@emdash/core/primitives/operations/api';

export interface ProjectResourceRef {
  projectId: string;
}

export interface TaskResourceRef extends ProjectResourceRef {
  taskId: string;
}

export interface WorkspaceResourceRef extends ProjectResourceRef {
  workspaceId: string;
}

export interface BranchResourceRef extends ProjectResourceRef {
  branchName: string;
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

export interface ConversationResourceRef {
  conversationId: string;
}

// No project parent: a conversation record may be an unlinked host mirror (no project).
export const conversationKernelResource = defineResource<'conversation', ConversationResourceRef>({
  name: 'conversation',
  key: (ref) => `conversation:${encodeURIComponent(ref.conversationId)}`,
});

export const branchKernelResource = defineResource<'branch', BranchResourceRef>({
  name: 'branch',
  key: (ref) =>
    operationClaimResourceKey({
      kind: 'branch',
      projectId: ref.projectId,
      name: ref.branchName,
    }),
  parent: (ref) => ({ def: projectKernelResource, ref: { projectId: ref.projectId } }),
});

export function projectClaimKey(projectId: string): string {
  return projectKernelResource.key({ projectId });
}

export function branchKernelClaim(projectId: string, branchName: string): ResourceClaim[] {
  return branchKernelResource.mutates({ projectId, branchName });
}

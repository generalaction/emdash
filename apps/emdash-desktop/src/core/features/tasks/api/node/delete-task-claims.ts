import type { OperationClaimResource } from '@core/primitives/operations/api';

export function deleteTaskClaims(input: {
  projectId: string;
  taskId: string;
  workspaceId: string | null;
  branchName?: string;
  hostRef: string;
  workspacePath?: string;
  workspaceShared: boolean;
}): OperationClaimResource[] {
  const claims: OperationClaimResource[] = [{ kind: 'task', id: input.taskId }];
  if (input.workspaceShared) return claims;
  if (input.workspaceId) claims.push({ kind: 'workspace', id: input.workspaceId });
  if (input.branchName) {
    claims.push({ kind: 'branch', projectId: input.projectId, name: input.branchName });
  }
  if (input.workspacePath) {
    claims.push({ kind: 'worktree', hostRef: input.hostRef, path: input.workspacePath });
  }
  return claims;
}

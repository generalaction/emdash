/**
 * Typed workspace ID utilities.
 *
 * Key scheme:
 *   local:{projectId}:branch:{branch}  — local worktree, shared across tasks on the same branch
 *   local:{projectId}:root             — local project root (no worktree)
 *   ssh:{projectId}:branch:{branch}    — SSH project worktree
 *   ssh:{projectId}:root               — SSH project root
 *   remote:{remoteId}                  — BYOI remote task; keyed by output.id when available,
 *                                        else task ID. Tasks sharing the same output.id share
 *                                        the same workspace entry with ref-counting.
 */

export function localWorkspaceId(projectId: string, taskBranch: string | undefined): string {
  return taskBranch ? `local:${projectId}:branch:${taskBranch}` : `local:${projectId}:root`;
}

export function sshWorkspaceId(projectId: string, taskBranch: string | undefined): string {
  return taskBranch ? `ssh:${projectId}:branch:${taskBranch}` : `ssh:${projectId}:root`;
}

/**
 * BYOI remote task workspace.
 * Pass `output.id` when the provision script returns one; fall back to the task ID.
 * Caller: `remoteTaskWorkspaceId(output.id ?? task.id)`
 */
export function remoteTaskWorkspaceId(remoteId: string): string {
  return `remote:${remoteId}`;
}

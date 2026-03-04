/** Fires a worktree reserve pre-warm for the given project + base ref. */
export function prewarmWorktreeReserve(
  projectId: string,
  projectPath: string,
  isGitRepo: boolean | undefined,
  baseRef?: string
): void {
  if (!isGitRepo) return;
  const requestedBaseRef = (baseRef || '').trim() || 'HEAD';
  window.electronAPI
    .worktreeEnsureReserve({ projectId, projectPath, baseRef: requestedBaseRef })
    .catch(() => {});
}

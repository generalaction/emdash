export type GitWorktreeEntry = {
  path: string;
  branch?: string;
};

export function parseGitWorktreeList(output: string): GitWorktreeEntry[] {
  return output
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const worktreeLine = lines.find((line) => line.startsWith('worktree '));
      const branchLine = lines.find((line) => line.startsWith('branch '));
      return {
        path: worktreeLine?.slice('worktree '.length) ?? '',
        branch: branchLine?.slice('branch '.length),
      };
    })
    .filter((entry) => entry.path);
}

export function worktreePathForBranch(
  entries: GitWorktreeEntry[],
  branchName: string
): string | undefined {
  const branchRef = `refs/heads/${branchName}`;
  return entries.find((entry) => entry.branch === branchRef)?.path;
}

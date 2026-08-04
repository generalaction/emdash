import { createHash } from 'node:crypto';
import path from 'node:path';

const WORKTREE_POOL_HASH_LENGTH = 8;

export type DeriveWorktreePoolPathOptions = {
  worktreesRoot: string;
  repoPath: string;
};

export function defaultRepositoriesRoot(homeDirectory: string): string {
  return pathApiFor(homeDirectory).join(homeDirectory, 'emdash', 'repositories');
}

export function defaultWorktreesRoot(homeDirectory: string): string {
  return pathApiFor(homeDirectory).join(homeDirectory, 'emdash', 'worktrees');
}

export function deriveWorktreePoolPath({
  worktreesRoot,
  repoPath,
}: DeriveWorktreePoolPathOptions): string {
  const pathApi = pathApiFor(worktreesRoot);
  const repoBasename = pathApi.basename(repoPath) || 'repository';
  const repoHash = createHash('sha256')
    .update(repoPath)
    .digest('hex')
    .slice(0, WORKTREE_POOL_HASH_LENGTH);
  return pathApi.join(worktreesRoot, `${repoBasename}-${repoHash}`);
}

function pathApiFor(absolutePath: string): typeof path.posix {
  return /^[a-zA-Z]:[\\/]/u.test(absolutePath) || absolutePath.startsWith('\\\\')
    ? path.win32
    : path.posix;
}

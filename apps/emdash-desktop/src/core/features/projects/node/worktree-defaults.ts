import { homedir } from 'node:os';
import path from 'node:path';

export const WORKTREE_POOL_DIR_NAME = 'worktrees';
export const LOCAL_WORKTREE_ROOT_DIR_NAME = 'emdash';

export function getDefaultLocalWorktreeDirectory(homeDirectory: string = homedir()): string {
  return path.join(homeDirectory, LOCAL_WORKTREE_ROOT_DIR_NAME, WORKTREE_POOL_DIR_NAME);
}

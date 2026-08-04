import { formatAbsolute, parseAbsolute, type HostAbsolutePath } from '@primitives/path/api';
import type { BoundExec } from '@services/exec/api';
import { createWorkspaceHostGitExec, parseWorkspaceHostWorktreeList } from '../git';

export type GitExecFactory = (cwd: string) => BoundExec;

export const defaultGitExecFactory: GitExecFactory = (cwd) => createWorkspaceHostGitExec(cwd);

export async function listWorktreePaths(exec: BoundExec): Promise<Set<string>> {
  const result = await exec.exec(['worktree', 'list', '--porcelain']);
  return new Set(
    parseWorkspaceHostWorktreeList(result.stdout, parseAbsoluteOrThrow).map((worktree) =>
      formatAbsolute(worktree.worktreePath)
    )
  );
}

export async function branchExists(exec: BoundExec, branchName: string): Promise<boolean> {
  try {
    await exec.exec(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

export async function deleteBranchIfExists(exec: BoundExec, branchName: string): Promise<boolean> {
  if (!(await branchExists(exec, branchName))) return false;
  await exec.exec(['branch', '-D', branchName]);
  return true;
}

export function isMissingGitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not a working tree|is not a working tree|No such file|not found|does not exist/iu.test(
    message
  );
}

function parseAbsoluteOrThrow(path: string): HostAbsolutePath {
  const parsed = parseAbsolute(path);
  if (!parsed.success) {
    throw new Error(`Git returned a non-absolute worktree path: ${path}`);
  }
  return parsed.data;
}

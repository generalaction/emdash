import fs from 'fs';
import path from 'path';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { Branch } from '@shared/git';
import { mapWorktreeErrorToProvisionError } from '../../tasks/provision-task-error';
import type { WorktreeService } from './worktree-service';

export const ensureLocalWorktreeDirectory = ({
  directory,
  projectName,
}: {
  directory?: string;
  projectName: string;
}): string => {
  directory = directory ?? path.join('emdash', 'projects', 'worktrees', projectName);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return directory;
};

export const ensureSshWorktreeDirectory = async ({
  directory,
  projectName,
  rootFs,
}: {
  directory?: string;
  projectName: string;
  rootFs: FileSystemProvider;
}): Promise<string> => {
  directory = directory ?? path.join('emdash', 'projects', 'worktrees', projectName);

  const exists = await rootFs.exists(directory);
  if (!exists) {
    await rootFs.mkdir(directory, { recursive: true });
  }
  return directory;
};

export async function resolveTaskWorkDir(
  workspace: { branchName: string | null; sourceBranch: Branch | undefined },
  projectPath: string,
  worktreeService: WorktreeService
): Promise<string> {
  if (!workspace.branchName) return projectPath;

  const existing = await worktreeService.getWorktree(workspace.branchName);
  if (existing) return existing;

  if (!workspace.sourceBranch || workspace.branchName === workspace.sourceBranch.branch) {
    const result = await worktreeService.checkoutExistingBranch(workspace.branchName);
    if (!result.success) throw mapWorktreeErrorToProvisionError(workspace.branchName, result.error);
    return result.data;
  }

  const result = await worktreeService.checkoutBranchWorktree(
    workspace.sourceBranch,
    workspace.branchName
  );
  if (!result.success) throw mapWorktreeErrorToProvisionError(workspace.branchName, result.error);
  return result.data;
}

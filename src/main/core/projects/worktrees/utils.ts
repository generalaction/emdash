import fs from 'fs';
import path from 'path';
import type { Task } from '@shared/tasks';
import type { FileSystemProvider } from '@main/core/fs/types';
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
  task: Pick<Task, 'taskBranch' | 'sourceBranch'>,
  projectPath: string,
  worktreeService: WorktreeService
): Promise<string> {
  if (!task.taskBranch) return projectPath;

  const existing = await worktreeService.getWorktree(task.taskBranch);
  if (existing) return existing;

  if (!task.sourceBranch || task.taskBranch === task.sourceBranch.branch) {
    const result = await worktreeService.checkoutExistingBranch(task.taskBranch);
    if (!result.success) throw mapWorktreeErrorToProvisionError(task.taskBranch, result.error);
    return result.data;
  }

  const result = await worktreeService.checkoutBranchWorktree(task.sourceBranch, task.taskBranch);
  if (!result.success) throw mapWorktreeErrorToProvisionError(task.taskBranch, result.error);
  return result.data;
}

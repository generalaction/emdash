import path from 'node:path';
import type { FileError, IFileSystem } from '@emdash/core/files';
import type { CloneRepositoryError, GitHeadModel, IGitWorktree } from '@emdash/core/git';
import { ensureAbsoluteDir, openFileSystem, statAbsolute } from '@main/core/runtime/files-helpers';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import type { IFilesRuntime } from '@main/core/runtime/types';
import type { MachineRef } from '@main/core/runtime/types';

export type GitRepositorySetupResult = { success: true } | { success: false; error: string };

export type CloneProjectRepositoryParams = {
  repositoryUrl: string;
  targetPath: string;
  connectionId?: string;
};

export type InitializeProjectRepositoryParams = {
  targetPath: string;
  name: string;
  description?: string;
  connectionId?: string;
};

function machineForConnection(connectionId: string | undefined): MachineRef {
  return connectionId ? { kind: 'ssh', connectionId } : { kind: 'local' };
}

function parentPathForMachine(targetPath: string, machine: MachineRef): string {
  return machine.kind === 'ssh' ? path.posix.dirname(targetPath) : path.dirname(targetPath);
}

function cloneRepositoryErrorMessage(error: CloneRepositoryError): string {
  switch (error.type) {
    case 'target_exists':
      return `Target directory already exists and is not empty: ${error.path}`;
    case 'auth_failed':
    case 'remote_not_found':
    case 'git_error':
      return error.message;
  }
}

function fileErrorMessage(error: FileError): string {
  return error.message;
}

function initialReadmeContent(name: string, description: string | undefined): string {
  return description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
}

function initialBranchCandidates(head: GitHeadModel): string[] {
  if (head.kind === 'branch' || head.kind === 'unborn') return [head.name];
  return ['main', 'master'];
}

async function pushInitialBranch(worktree: IGitWorktree): Promise<GitRepositorySetupResult> {
  const head = await worktree.getHead();
  let message = 'Failed to push to remote repository';

  for (const branchName of initialBranchCandidates(head)) {
    const result = await worktree.repository.publishBranch(branchName, 'origin');
    if (result.success) return { success: true };
    message = result.error.message || message;
  }

  return { success: false, error: message };
}

export async function cloneProjectRepository(
  params: CloneProjectRepositoryParams
): Promise<GitRepositorySetupResult> {
  const machine = machineForConnection(params.connectionId);
  const runtimeLease = await runtimeManager.acquire(machine);
  try {
    const madeParentDir = await ensureAbsoluteDir(
      runtimeLease.value.files,
      parentPathForMachine(params.targetPath, machine)
    );
    if (!madeParentDir.success) {
      return { success: false, error: fileErrorMessage(madeParentDir.error) };
    }
    const result = await runtimeLease.value.git.cloneRepository(
      params.repositoryUrl,
      params.targetPath
    );
    if (!result.success) {
      return { success: false, error: cloneRepositoryErrorMessage(result.error) };
    }
    return { success: true };
  } finally {
    await runtimeLease.release();
  }
}

export async function initializeProjectRepository(
  params: InitializeProjectRepositoryParams
): Promise<GitRepositorySetupResult> {
  const machine = machineForConnection(params.connectionId);
  const runtimeLease = await runtimeManager.acquire(machine);
  try {
    const projectFs = await ensureProjectDirectory(runtimeLease.value.files, params.targetPath);
    if (!projectFs.success) return { success: false, error: projectFs.error };

    const readmePath = runtimeLease.value.files.path.join(params.targetPath, 'README.md');
    const writeResult = await projectFs.data.writeText(
      readmePath,
      initialReadmeContent(params.name, params.description)
    );
    if (!writeResult.success) {
      return { success: false, error: fileErrorMessage(writeResult.error) };
    }

    const worktreeLease = await runtimeLease.value.git.openWorktree(params.targetPath);
    try {
      const stageResult = await worktreeLease.value.stage([readmePath]);
      if (!stageResult.success) return { success: false, error: stageResult.error.message };
      const commitResult = await worktreeLease.value.commit('Initial commit');
      if (!commitResult.success) return { success: false, error: commitResult.error.message };
      return await pushInitialBranch(worktreeLease.value);
    } finally {
      await worktreeLease.release();
    }
  } finally {
    await runtimeLease.release();
  }
}

async function ensureProjectDirectory(
  files: IFilesRuntime,
  targetPath: string
): Promise<{ success: true; data: IFileSystem } | { success: false; error: string }> {
  const stat = await statAbsolute(files, targetPath);
  if (!stat.success) return { success: false, error: 'Local path does not exist' };
  if (stat.data.type !== 'directory') {
    return { success: false, error: `Path is not a directory: ${targetPath}` };
  }
  const opened = openFileSystem(files);
  if (!opened.success) return { success: false, error: fileErrorMessage(opened.error) };
  return { success: true, data: opened.data };
}

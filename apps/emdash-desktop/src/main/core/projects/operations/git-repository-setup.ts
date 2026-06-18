import path from 'node:path';
import type { CloneRepositoryError, GitHeadModel, IGitWorktree } from '@emdash/core/git';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import type { MachineRef } from '@main/core/runtime/types';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';

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

async function createProjectFs(root: string, machine: MachineRef): Promise<FileSystemProvider> {
  if (machine.kind === 'ssh') {
    const proxy = await sshConnectionManager.connect(machine.connectionId);
    return new SshFileSystem(proxy, root);
  }
  return new LocalFileSystem(root);
}

function cloneRepositoryErrorMessage(error: CloneRepositoryError): string {
  switch (error.type) {
    case 'target-exists':
      return `Target directory already exists and is not empty: ${error.path}`;
    case 'auth-failed':
    case 'remote-not-found':
    case 'git-error':
      return error.message;
  }
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
  const parentFs = await createProjectFs(parentPathForMachine(params.targetPath, machine), machine);
  await parentFs.mkdir('.', { recursive: true });

  const runtimeLease = await runtimeManager.acquire(machine);
  try {
    const result = await runtimeLease.value.git.cloneRepository(
      params.repositoryUrl,
      params.targetPath
    );
    if (!result.success) {
      return { success: false, error: cloneRepositoryErrorMessage(result.error) };
    }
    return { success: true };
  } finally {
    runtimeLease.release();
  }
}

export async function initializeProjectRepository(
  params: InitializeProjectRepositoryParams
): Promise<GitRepositorySetupResult> {
  const machine = machineForConnection(params.connectionId);
  const projectFs = await createProjectFs(params.targetPath, machine);

  if (!(await projectFs.exists('.'))) {
    return { success: false, error: 'Local path does not exist' };
  }

  const writeResult = await projectFs.write(
    'README.md',
    initialReadmeContent(params.name, params.description)
  );
  if (!writeResult.success) {
    return { success: false, error: writeResult.error || 'Failed to write README.md' };
  }

  const runtimeLease = await runtimeManager.acquire(machine);
  try {
    const worktreeLease = await runtimeLease.value.git.openWorktree(params.targetPath);
    try {
      await worktreeLease.value.stage(['README.md']);
      const commitResult = await worktreeLease.value.commit('Initial commit');
      if (!commitResult.success) return { success: false, error: commitResult.error.message };
      return await pushInitialBranch(worktreeLease.value);
    } finally {
      worktreeLease.release();
    }
  } finally {
    runtimeLease.release();
  }
}

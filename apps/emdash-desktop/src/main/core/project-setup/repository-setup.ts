import path from 'node:path';
import type { CheckoutHeadState } from '@emdash/core/git';
import { RuntimeFileSystem } from '@main/core/files/runtime-files';
import { fsErrorMessage } from '@main/core/files/scoped-file-system';
import { gitErrorMessage, RuntimeGit, type RuntimeGitCheckout } from '@main/core/git/runtime-git';
import { ensureAbsoluteDir } from '@main/core/runtime/files-helpers';

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

const git = new RuntimeGit();

function initialReadmeContent(name: string, description: string | undefined): string {
  return description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
}

function initialBranchCandidates(head: CheckoutHeadState): string[] {
  if (head.kind === 'branch' || head.kind === 'unborn') return [head.name];
  return ['main', 'master'];
}

async function pushInitialBranch(worktree: RuntimeGitCheckout): Promise<GitRepositorySetupResult> {
  const head = await worktree.getHead();
  let message = 'Failed to push to remote repository';
  for (const branchName of initialBranchCandidates(head)) {
    const result = await worktree.repository.publishBranch(branchName, 'origin');
    if (result.success) return { success: true };
    message = gitErrorMessage(result.error) || message;
  }
  return { success: false, error: message };
}

export async function cloneProjectRepository(
  params: CloneProjectRepositoryParams
): Promise<GitRepositorySetupResult> {
  if (params.connectionId) return unsupportedRemote();
  const parentPath = path.dirname(params.targetPath);
  const madeParent = await ensureAbsoluteDir(path.dirname(parentPath), parentPath);
  if (!madeParent.success) return { success: false, error: fsErrorMessage(madeParent.error) };
  const result = await git.cloneRepository(params.repositoryUrl, params.targetPath);
  return result.success
    ? { success: true }
    : { success: false, error: gitErrorMessage(result.error) };
}

export async function initializeProjectRepository(
  params: InitializeProjectRepositoryParams
): Promise<GitRepositorySetupResult> {
  if (params.connectionId) return unsupportedRemote();
  const fileSystem = new RuntimeFileSystem(params.targetPath);
  const stat = await fileSystem.stat(params.targetPath);
  if (!stat.success) return { success: false, error: fsErrorMessage(stat.error) };
  if (stat.data.type !== 'directory') {
    return { success: false, error: `Path is not a directory: ${params.targetPath}` };
  }

  const ensured = await git.ensureRepository(params.targetPath, true);
  if (!ensured.success) return { success: false, error: gitErrorMessage(ensured.error) };
  const readmePath = path.join(params.targetPath, 'README.md');
  const written = await fileSystem.writeText(
    readmePath,
    initialReadmeContent(params.name, params.description)
  );
  if (!written.success) return { success: false, error: fsErrorMessage(written.error) };

  const checkout = git.checkout(params.targetPath);
  const staged = await checkout.stage(['README.md']);
  if (!staged.success) return { success: false, error: gitErrorMessage(staged.error) };
  const committed = await checkout.commit('Initial commit');
  if (!committed.success) return { success: false, error: gitErrorMessage(committed.error) };
  return pushInitialBranch(checkout);
}

function unsupportedRemote(): GitRepositorySetupResult {
  return {
    success: false,
    error: 'Remote projects require the workspace server and are not supported by this build',
  };
}

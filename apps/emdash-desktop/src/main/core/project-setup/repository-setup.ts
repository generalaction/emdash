import path from 'node:path';
import { gitContract, type CheckoutHeadState, type CheckoutSelector } from '@emdash/core/git';
import {
  fileKey,
  fileMutationKey,
  filesClientScope,
  fsErrorMessage,
} from '@main/core/files/runtime-process/client';
import { getFilesRuntimeClient } from '@main/core/files/runtime-process/host';
import {
  checkoutSelector,
  gitErrorMessage,
  gitFilePath,
  mutationResult,
  runGitJob,
} from '@main/core/git/runtime-process/client';
import { getGitRuntimeClient, type GitRuntimeClient } from '@main/core/git/runtime-process/host';
import { ensureAbsoluteDir } from '@main/core/runtime/files-helpers';
import { hostPathFromNative } from '@shared/core/runtime/paths';

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

function initialReadmeContent(name: string, description: string | undefined): string {
  return description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
}

function initialBranchCandidates(head: CheckoutHeadState): string[] {
  if (head.kind === 'branch' || head.kind === 'unborn') return [head.name];
  return ['main', 'master'];
}

async function pushInitialBranch(
  git: GitRuntimeClient,
  checkout: CheckoutSelector
): Promise<GitRepositorySetupResult> {
  const head = (await git.checkout.model.state(checkout, 'head').snapshot()).data;
  const repository = repositorySelectorFromCheckout(checkout);
  let message = 'Failed to push to remote repository';
  for (const branchName of initialBranchCandidates(head)) {
    const result = await runGitJob(
      gitContract.repository.publishBranch,
      git.repository.publishBranch,
      { ...repository, branchName, remote: 'origin' }
    );
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
  const git = await getGitRuntimeClient();
  const result = await runGitJob(gitContract.cloneRepository, git.cloneRepository, {
    repositoryUrl: params.repositoryUrl,
    targetPath: hostPathFromNative(params.targetPath),
  });
  return result.success
    ? { success: true }
    : { success: false, error: gitErrorMessage(result.error) };
}

export async function initializeProjectRepository(
  params: InitializeProjectRepositoryParams
): Promise<GitRepositorySetupResult> {
  if (params.connectionId) return unsupportedRemote();
  const [git, filesClient] = await Promise.all([getGitRuntimeClient(), getFilesRuntimeClient()]);
  const files = filesClientScope(filesClient, params.targetPath);
  const stat = await filesClient.fs.stat(fileKey(files, params.targetPath));
  if (!stat.success) return { success: false, error: fsErrorMessage(stat.error) };
  if (stat.data.type !== 'directory') {
    return { success: false, error: `Path is not a directory: ${params.targetPath}` };
  }

  const ensured = await git.ensureRepository({
    path: hostPathFromNative(params.targetPath),
    options: { initIfMissing: true },
  });
  if (!ensured.success) return { success: false, error: gitErrorMessage(ensured.error) };
  const readmePath = path.join(params.targetPath, 'README.md');
  const written = await filesClient.mutations.writeFile({
    ...fileMutationKey(files, readmePath),
    content: initialReadmeContent(params.name, params.description),
    precondition: { kind: 'overwrite' },
  });
  if (!written.success) return { success: false, error: fsErrorMessage(written.error) };

  const checkout = checkoutSelector(params.targetPath);
  const staged = await mutationResult(
    git.checkout.model.mutate('stage', {
      key: checkout,
      input: { paths: [gitFilePath('README.md')] },
    })
  );
  if (!staged.success) return { success: false, error: gitErrorMessage(staged.error) };
  const committed = await mutationResult(
    git.checkout.model.mutate('commit', {
      key: checkout,
      input: { message: 'Initial commit' },
    })
  );
  if (!committed.success) return { success: false, error: gitErrorMessage(committed.error) };
  return pushInitialBranch(git, checkout);
}

function repositorySelectorFromCheckout(checkout: CheckoutSelector) {
  return { repository: checkout.checkout };
}

function unsupportedRemote(): GitRepositorySetupResult {
  return {
    success: false,
    error: 'Remote projects require the workspace server and are not supported by this build',
  };
}

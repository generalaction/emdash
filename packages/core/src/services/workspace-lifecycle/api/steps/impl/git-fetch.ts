import { gitFetchStep } from '@services/workspace-lifecycle/api/steps/catalog';
import { implement, stepErr, stepOk } from '@services/workspace-lifecycle/api/steps/implement';
import { gitErrorMessage, runGit } from '@services/workspace-lifecycle/api/steps/run-git';
import { runGitStreaming } from '@services/workspace-lifecycle/api/steps/run-git-streaming';
import { gitFailure } from './helpers';

export const gitFetchImpl = implement(gitFetchStep, async (args, ctx) => {
  const gitArgs = ['fetch', '--progress', args.remote];
  if (args.refspec) gitArgs.push(args.refspec);
  if (args.force) gitArgs.push('--force');

  const result = await runGitStreaming(gitArgs, {
    cwd: ctx.repoPath,
    signal: ctx.signal,
    onOutput: ctx.emitOutput,
    onProgress: ctx.reportProgress,
  });
  if (result.success) return stepOk();

  const message = gitErrorMessage(result.error);
  const checkedOutBranch = destinationLocalBranch(args.refspec);
  if (
    checkedOutBranch &&
    isCheckedOutBranchFetchError(message) &&
    (await isBranchCheckedOut(checkedOutBranch, ctx))
  ) {
    return stepOk();
  }

  const failure = gitFailure('fetch-failed', result.error);
  return stepErr(failure.failureClass, failure.error);
});

function destinationLocalBranch(refspec: string | undefined): string | undefined {
  if (!refspec) return undefined;
  const destination = refspec.split(':')[1];
  if (!destination?.startsWith('refs/heads/')) return undefined;
  return destination.slice('refs/heads/'.length);
}

function isCheckedOutBranchFetchError(message: string): boolean {
  return /refusing to fetch into branch .+ checked out/i.test(message);
}

async function isBranchCheckedOut(
  branchName: string,
  ctx: { repoPath: string; signal?: AbortSignal }
): Promise<boolean> {
  const result = await runGit(['worktree', 'list', '--porcelain'], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (!result.success) return false;
  const branchLine = `branch refs/heads/${branchName}`;
  return result.data.stdout
    .split('\n\n')
    .some((block) => block.split('\n').some((line) => line === branchLine));
}

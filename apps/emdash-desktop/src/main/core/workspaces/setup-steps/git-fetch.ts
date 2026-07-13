import { gitContract } from '@emdash/core/runtimes/git/api';
import { err, ok, type Result } from '@emdash/shared';
import { gitErrorMessage, runGitJob } from '@main/core/git/runtime-process/client';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/git-fetch';
import type { StepContext } from './step-context';

function destinationLocalBranch(refspec: string | undefined): string | undefined {
  const destination = refspec?.split(':')[1];
  return destination?.startsWith('refs/heads/')
    ? destination.slice('refs/heads/'.length)
    : undefined;
}

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { remote, refspec, force } = args;
  const fetched = await runGitJob(gitContract.repository.fetch, ctx.git.repository.fetch, {
    ...ctx.repository,
    remote,
    refspec,
    force,
  });
  if (fetched.success) return ok({});

  const checkedOutBranch = destinationLocalBranch(refspec);
  if (checkedOutBranch) {
    const worktrees = await ctx.git.repository.listWorktrees(ctx.repository);
    if (
      worktrees.success &&
      worktrees.data.some(
        (worktree) => worktree.head.kind === 'branch' && worktree.head.name === checkedOutBranch
      )
    ) {
      return ok({});
    }
  }
  const code = fetched.error.type === 'git_error' ? fetched.error.code : undefined;
  return err({
    type: 'fetch-failed',
    remote,
    refspec,
    ...(code ? { code } : {}),
    message: gitErrorMessage(fetched.error),
  });
}

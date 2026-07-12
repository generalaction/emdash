import { err, ok, type Result } from '@emdash/shared';
import { gitErrorMessage } from '@main/core/git/runtime-git';
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
  const fetched = await ctx.gitRepository.fetch(remote, { refspec, force });
  if (fetched.success) return ok({});

  const checkedOutBranch = destinationLocalBranch(refspec);
  if (checkedOutBranch) {
    const worktrees = await ctx.gitRepository.listWorktrees();
    if (
      worktrees.success &&
      worktrees.data.some(
        (worktree) => worktree.head.kind === 'branch' && worktree.head.name === checkedOutBranch
      )
    ) {
      return ok({});
    }
  }
  return err({
    type: 'fetch-failed',
    remote,
    refspec,
    message: gitErrorMessage(fetched.error),
  });
}

import type * as Step from '@shared/core/workspaces/workspace-setup-steps/add-worktree';
import { err, ok, type Result } from '@shared/lib/result';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { branchName } = args;
  const result = await ctx.worktreeService.serveBranchWorktree(branchName, undefined, false);

  if (result.success) {
    return ok({ path: result.data });
  }

  if (result.error.type === 'branch-not-found') {
    return err({
      type: 'worktree-failed',
      branchName,
      message: `Branch "${result.error.branch}" was not found locally or on remote`,
    });
  }

  return err({
    type: 'worktree-failed',
    branchName,
    message:
      result.error.cause instanceof Error ? result.error.cause.message : String(result.error.cause),
  });
}

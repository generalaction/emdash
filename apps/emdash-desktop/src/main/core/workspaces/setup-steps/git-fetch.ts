import { err, ok, type Result } from '@emdash/shared';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/git-fetch';
import type { StepContext } from './step-context';

function destinationLocalBranch(refspec: string | undefined): string | undefined {
  if (!refspec) return undefined;
  const destination = refspec.split(':')[1];
  if (!destination?.startsWith('refs/heads/')) return undefined;
  return destination.slice('refs/heads/'.length);
}

function isCheckedOutBranchFetchError(message: string): boolean {
  return /refusing to fetch into branch .+ checked out/i.test(message);
}

async function isBranchCheckedOut(branchName: string, ctx: StepContext): Promise<boolean> {
  try {
    const { stdout } = await ctx.ctx.exec('git', ['worktree', 'list', '--porcelain']);
    const branchLine = `branch refs/heads/${branchName}`;
    return stdout
      .split('\n\n')
      .some((block) => block.split('\n').some((line) => line === branchLine));
  } catch {
    return false;
  }
}

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { remote, refspec, force } = args;
  const gitArgs = ['fetch', remote];
  if (refspec) gitArgs.push(refspec);
  if (force) gitArgs.push('--force');

  try {
    await ctx.ctx.exec('git', gitArgs);
    return ok({});
  } catch (error: unknown) {
    const message = (error as { stderr?: string })?.stderr ?? String(error);
    const checkedOutBranch = destinationLocalBranch(refspec);
    if (
      checkedOutBranch &&
      isCheckedOutBranchFetchError(message) &&
      (await isBranchCheckedOut(checkedOutBranch, ctx))
    ) {
      return ok({});
    }
    return err({ type: 'fetch-failed', remote, refspec, message });
  }
}

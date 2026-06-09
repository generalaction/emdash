import type * as Step from '@shared/core/workspaces/workspace-setup-steps/git-fetch';
import { err, ok, type Result } from '@shared/lib/result';
import type { StepContext } from './step-context';

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
    return err({ type: 'fetch-failed', remote, refspec, message });
  }
}

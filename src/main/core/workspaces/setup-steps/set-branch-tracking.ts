import { log } from '@main/lib/logger';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/set-branch-tracking';
import { ok, type Result } from '@shared/lib/result';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const { branchName, remote, remoteBranch } = args;
  try {
    await ctx.ctx.exec('git', [
      'branch',
      `--set-upstream-to=${remote}/${remoteBranch}`,
      branchName,
    ]);
  } catch (error: unknown) {
    // Non-fatal: missing remote tracking branch is common for new branches.
    log.warn('setup-steps/set-branch-tracking: failed to set upstream', {
      branchName,
      remote,
      remoteBranch,
      error: String(error),
    });
  }
  return ok({});
}

import { log } from '@main/lib/logger';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/push-branch';
import { ok, type Result } from '@shared/lib/result';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const { branchName, remote, setUpstream } = args;
  try {
    await ctx.ctx.exec('git', ['push', ...(setUpstream ? ['-u'] : []), remote, branchName]);
  } catch (error: unknown) {
    // Non-fatal: push failures are surfaced as warnings upstream.
    log.warn('setup-steps/push-branch: failed to push branch', {
      branchName,
      remote,
      error: String(error),
    });
  }
  return ok({});
}

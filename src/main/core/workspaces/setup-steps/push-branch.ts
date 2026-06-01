import { log } from '@main/lib/logger';
import { ok, type Result } from '@shared/result';
import type * as Step from '@shared/workspace-setup-steps/push-branch';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const { branchName, remote } = args;
  try {
    await ctx.ctx.exec('git', ['push', remote, branchName]);
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

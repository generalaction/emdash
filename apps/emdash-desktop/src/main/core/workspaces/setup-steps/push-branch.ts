import { ok, type Result } from '@emdash/shared';
import { log } from '@main/lib/logger';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/push-branch';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const result = await ctx.gitRepository.publishBranch(args.branchName, args.remote);
  if (!result.success) {
    log.warn('setup-steps/push-branch: failed to push branch', {
      branchName: args.branchName,
      remote: args.remote,
      error: result.error,
    });
  }
  return ok({});
}

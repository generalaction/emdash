import { ok, type Result } from '@emdash/shared';
import { log } from '@main/lib/logger';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/set-branch-base';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const result = await ctx.gitRepository.setBranchBase(args.branchName, args.baseRef);
  if (!result.success) {
    log.warn('setup-steps/set-branch-base: failed to set branch base config', {
      branchName: args.branchName,
      baseRef: args.baseRef,
      error: result.error,
    });
  }
  return ok({});
}

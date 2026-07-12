import { ok, type Result } from '@emdash/shared';
import { mutationResult } from '@main/core/git/runtime-process/client';
import { log } from '@main/lib/logger';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/set-branch-tracking';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const upstream = `${args.remote}/${args.remoteBranch}`;
  const result = await mutationResult(
    ctx.git.repository.model.mutate('setUpstream', {
      key: ctx.repository,
      input: { branch: args.branchName, upstream },
    })
  );
  if (!result.success) {
    log.warn('setup-steps/set-branch-tracking: failed to set upstream', {
      branchName: args.branchName,
      upstream,
      error: result.error,
    });
  }
  return ok({});
}

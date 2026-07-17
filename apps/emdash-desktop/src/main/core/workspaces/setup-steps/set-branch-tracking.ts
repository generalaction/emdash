import { ok, type Result } from '@emdash/shared';
import type * as Step from '@core/primitives/workspaces/api/workspace-setup-steps/set-branch-tracking';
import { mutationResult } from '@main/core/git/runtime-client';
import { log } from '@main/lib/logger';
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

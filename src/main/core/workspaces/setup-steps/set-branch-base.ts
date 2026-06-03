import { log } from '@main/lib/logger';
import { ok, type Result } from '@shared/result';
import type * as Step from '@shared/workspace-setup-steps/set-branch-base';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, never>> {
  const { branchName, baseRef } = args;
  const key = `branch.${branchName}.base`;
  try {
    // Idempotent: skip if already set.
    const { stdout } = await ctx.ctx.exec('git', ['config', '--get', key]).catch(() => ({
      stdout: '',
    }));
    if (stdout.trim()) return ok({});

    await ctx.ctx.exec('git', ['config', key, baseRef]);
  } catch (error: unknown) {
    log.warn('setup-steps/set-branch-base: failed to set branch base config', {
      branchName,
      baseRef,
      error: String(error),
    });
  }
  return ok({});
}

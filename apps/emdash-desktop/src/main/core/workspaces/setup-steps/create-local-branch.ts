import { err, ok, type Result } from '@emdash/shared';
import type * as Step from '@shared/core/workspaces/workspace-setup-steps/create-local-branch';
import type { StepContext } from './step-context';

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { branchName, fromRef, noTrack } = args;

  // Check if branch already exists — treat as success (idempotent).
  try {
    await ctx.ctx.exec('git', ['rev-parse', '--verify', `refs/heads/${branchName}`]);
    return ok({});
  } catch {
    // Branch does not exist yet — proceed to create it.
  }

  const gitArgs = ['branch'];
  if (noTrack) gitArgs.push('--no-track');
  gitArgs.push(branchName, fromRef);

  try {
    await ctx.ctx.exec('git', gitArgs);
    return ok({});
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);

    if (stderr.includes('already exists')) {
      return ok({});
    }

    if (
      stderr.includes('not a valid object name') ||
      stderr.includes('unknown revision') ||
      stderr.includes('invalid reference')
    ) {
      return err({ type: 'ref-not-found', ref: fromRef });
    }

    return err({ type: 'create-failed', branchName, message: stderr });
  }
}

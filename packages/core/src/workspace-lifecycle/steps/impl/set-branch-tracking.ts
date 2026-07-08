import { setBranchTrackingStep } from '../catalog';
import { implement, stepErr, stepOk } from '../implement';
import { runGit } from '../run-git';
import { gitFailure } from './helpers';

export const setBranchTrackingImpl = implement(setBranchTrackingStep, async (args, ctx) => {
  const result = await runGit(
    ['branch', `--set-upstream-to=${args.remote}/${args.remoteBranch}`, args.branchName],
    { cwd: ctx.repoPath, signal: ctx.signal }
  );
  if (result.success) return stepOk();

  const failure = gitFailure('set-upstream-failed', result.error);
  return stepErr(failure.failureClass, failure.error);
});

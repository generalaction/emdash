import { pushBranchStep } from '../catalog';
import { implement, stepErr, stepOk } from '../implement';
import { runGit } from '../run-git';
import { gitFailure } from './helpers';

export const pushBranchImpl = implement(pushBranchStep, async (args, ctx) => {
  const result = await runGit(
    ['push', ...(args.setUpstream ? ['-u'] : []), args.remote, args.branchName],
    { cwd: ctx.repoPath, signal: ctx.signal }
  );
  if (result.success) return stepOk();

  const failure = gitFailure('push-branch-failed', result.error);
  return stepErr(failure.failureClass, failure.error);
});

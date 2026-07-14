import { gitCommitStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import { runGit } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import { gitFailure } from './helpers';

export const gitCommitImpl = implement(gitCommitStep, async (args, ctx) => {
  const cwd = ctx.resolvedWorktreePath ?? ctx.repoPath;
  const staged = await runGit(['add', '--', ...args.paths], { cwd, signal: ctx.signal });
  if (!staged.success) {
    const failure = gitFailure('git-stage-failed', staged.error);
    return stepErr(failure.failureClass, failure.error);
  }

  const committed = await runGit(['commit', '-m', args.message], { cwd, signal: ctx.signal });
  if (committed.success) return stepOk();

  const failure = gitFailure('git-commit-failed', committed.error);
  return stepErr(failure.failureClass, failure.error);
});

import { setBranchBaseStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import { runGit } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import { gitFailure } from './helpers';

export const setBranchBaseImpl = implement(setBranchBaseStep, async (args, ctx) => {
  const key = `branch.${args.branchName}.base`;
  const existing = await runGit(['config', '--get', key], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (existing.success && existing.data.stdout.trim()) return stepOk();

  const result = await runGit(['config', key, args.baseRef], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (result.success) return stepOk();

  const failure = gitFailure('set-branch-base-failed', result.error);
  return stepErr(failure.failureClass, failure.error);
});

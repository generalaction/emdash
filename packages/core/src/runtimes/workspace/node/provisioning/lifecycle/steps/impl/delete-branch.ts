import { deleteBranchStep } from '@runtimes/workspace/api/provisioning/catalog';
import { implement, stepOk } from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import { runGit } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';

export const deleteBranchImpl = implement(deleteBranchStep, async (args, ctx) => {
  const exists = await runGit(['rev-parse', '--verify', `refs/heads/${args.branchName}`], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (!exists.success) return stepOk();

  await runGit(['branch', '-D', args.branchName], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  return stepOk();
});

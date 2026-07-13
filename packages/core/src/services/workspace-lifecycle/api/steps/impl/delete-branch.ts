import { deleteBranchStep } from '@services/workspace-lifecycle/api/steps/catalog';
import { implement, stepOk } from '@services/workspace-lifecycle/api/steps/implement';
import { runGit } from '@services/workspace-lifecycle/api/steps/run-git';

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

import { deleteBranchStep } from '../catalog';
import { implement, stepOk } from '../implement';
import { runGit } from '../run-git';

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

import { removeWorktreeStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import { runGit } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import {
  removeStaleWorktreePath,
  validateWorktreeRemovalTarget,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/worktree-path-safety';

export const removeWorktreeImpl = implement(removeWorktreeStep, async (args, ctx) => {
  const safe = await validateWorktreeRemovalTarget(args.path, ctx);
  if (!safe.success) return stepErr('permanent', safe.error);

  const result = await runGit(['worktree', 'remove', '--force', args.path], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (result.success) return stepOk();

  const removed = await removeStaleWorktreePath(args.path, ctx);
  return removed.success ? stepOk() : stepErr('permanent', removed.error);
});

import { rm } from 'node:fs/promises';
import { removeWorktreeStep } from '@runtimes/workspace/api/provisioning/catalog';
import { implement, stepOk } from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import { runGit } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';

export const removeWorktreeImpl = implement(removeWorktreeStep, async (args, ctx) => {
  const result = await runGit(['worktree', 'remove', '--force', args.path], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (result.success) return stepOk();

  await rm(args.path, { recursive: true, force: true }).catch(() => {});
  return stepOk();
});

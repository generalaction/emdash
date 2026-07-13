import { rm } from 'node:fs/promises';
import { removeWorktreeStep } from '@services/workspace-lifecycle/api/steps/catalog';
import { implement, stepOk } from '@services/workspace-lifecycle/api/steps/implement';
import { runGit } from '@services/workspace-lifecycle/api/steps/run-git';

export const removeWorktreeImpl = implement(removeWorktreeStep, async (args, ctx) => {
  const result = await runGit(['worktree', 'remove', '--force', args.path], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (result.success) return stepOk();

  await rm(args.path, { recursive: true, force: true }).catch(() => {});
  return stepOk();
});

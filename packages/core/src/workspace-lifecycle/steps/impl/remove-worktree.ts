import { rm } from 'node:fs/promises';
import { removeWorktreeStep } from '../catalog';
import { implement, stepOk } from '../implement';
import { runGit } from '../run-git';

export const removeWorktreeImpl = implement(removeWorktreeStep, async (args, ctx) => {
  const result = await runGit(['worktree', 'remove', '--force', args.path], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (result.success) return stepOk();

  await rm(args.path, { recursive: true, force: true }).catch(() => {});
  return stepOk();
});

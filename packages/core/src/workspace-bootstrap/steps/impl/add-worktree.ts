import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { addWorktreeStep } from '../catalog';
import { implement, stepErr, stepOk, type StepCtx } from '../implement';
import { gitErrorMessage, runGit } from '../run-git';
import { gitFailure } from './helpers';

export const addWorktreeImpl = implement(addWorktreeStep, async (args, ctx) => {
  const existingPath = await getWorktreeForBranch(args.branchName, ctx);
  if (existingPath) return stepOk({ facts: { created: false, path: existingPath } });

  await runGit(['worktree', 'prune'], { cwd: ctx.repoPath, signal: ctx.signal });
  await mkdir(ctx.worktreePoolPath, { recursive: true });
  const worktreePath = path.join(ctx.worktreePoolPath, sanitizeBranchName(args.branchName));
  const result = await runGit(['worktree', 'add', worktreePath, args.branchName], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (result.success) return stepOk({ facts: { created: true, path: worktreePath } });

  const message = gitErrorMessage(result.error);
  if (message.includes('already checked out')) {
    const checkedOutPath = await getWorktreeForBranch(args.branchName, ctx);
    if (checkedOutPath) return stepOk({ facts: { created: false, path: checkedOutPath } });
  }

  const failure = gitFailure('worktree-failed', result.error);
  return stepErr(failure.failureClass, failure.error);
});

async function getWorktreeForBranch(
  branchName: string,
  ctx: Pick<StepCtx, 'repoPath' | 'signal'>
): Promise<string | undefined> {
  const result = await runGit(['worktree', 'list', '--porcelain'], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (!result.success) return undefined;

  const branchLine = `branch refs/heads/${branchName}`;
  for (const block of result.data.stdout.split('\n\n')) {
    const lines = block.split('\n');
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    if (!worktreeLine || !lines.includes(branchLine)) continue;
    return worktreeLine.slice('worktree '.length);
  }
  return undefined;
}

function sanitizeBranchName(branchName: string): string {
  return branchName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

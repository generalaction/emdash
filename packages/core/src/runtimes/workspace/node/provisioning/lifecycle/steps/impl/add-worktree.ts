import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { addWorktreeStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
  type StepCtx,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';
import {
  gitErrorMessage,
  runGit,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import { parseGitWorktreeList } from '@runtimes/workspace/node/provisioning/lifecycle/steps/worktree-list';
import { gitFailure } from './helpers';

export const addWorktreeImpl = implement(addWorktreeStep, async (args, ctx) => {
  const existingPath = await getWorktreeForBranch(args.branchName, ctx);
  if (existingPath === args.path) return stepOk({ facts: { created: false, path: args.path } });
  if (existingPath) {
    return stepErr('conflict', {
      type: 'branch-checked-out-elsewhere',
      message: `Branch "${args.branchName}" is already checked out at ${existingPath}`,
      resolutions: ['use-existing', 'remove-existing'],
    });
  }

  await runGit(['worktree', 'prune'], { cwd: ctx.repoPath, signal: ctx.signal });
  await mkdir(path.dirname(args.path), { recursive: true });
  const result = await runGit(['worktree', 'add', args.path, args.branchName], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (result.success) return stepOk({ facts: { created: true, path: args.path } });

  const message = gitErrorMessage(result.error);
  if (message.includes('already checked out')) {
    const checkedOutPath = await getWorktreeForBranch(args.branchName, ctx);
    if (checkedOutPath === args.path) return stepOk({ facts: { created: false, path: args.path } });
    if (checkedOutPath) {
      return stepErr('conflict', {
        type: 'branch-checked-out-elsewhere',
        message: `Branch "${args.branchName}" is already checked out at ${checkedOutPath}`,
        resolutions: ['use-existing', 'remove-existing'],
      });
    }
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

  const branchRef = `refs/heads/${branchName}`;
  return parseGitWorktreeList(result.data.stdout).find((entry) => entry.branch === branchRef)?.path;
}

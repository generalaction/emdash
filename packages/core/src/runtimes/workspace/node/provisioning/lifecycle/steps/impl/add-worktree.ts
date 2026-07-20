import { lstat, mkdir } from 'node:fs/promises';
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
import { removeStaleWorktreePath } from '@runtimes/workspace/node/provisioning/lifecycle/steps/worktree-path-safety';
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
  if (await pathExists(args.path)) {
    const registered = await getRegisteredWorktreeAtPath(args.path, ctx);
    if (registered) {
      return stepErr('conflict', {
        type: 'worktree-path-occupied',
        message: `The target path is already a registered worktree: ${args.path}`,
        resolutions: ['use-existing', 'choose-another-path'],
      });
    }

    const removed = await removeStaleWorktreePath(args.path, ctx);
    if (!removed.success) return stepErr('permanent', removed.error);
  }
  await mkdir(path.dirname(args.path), { recursive: true });
  const result = await runGit(
    ['-c', 'checkout.workers=0', 'worktree', 'add', args.path, args.branchName],
    {
      cwd: ctx.repoPath,
      signal: ctx.signal,
    }
  );
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

async function getRegisteredWorktreeAtPath(
  targetPath: string,
  ctx: Pick<StepCtx, 'repoPath' | 'signal'>
): Promise<boolean> {
  const result = await runGit(['worktree', 'list', '--porcelain'], {
    cwd: ctx.repoPath,
    signal: ctx.signal,
  });
  if (!result.success) return false;
  const normalizedTarget = path.resolve(targetPath);
  return parseGitWorktreeList(result.data.stdout).some(
    (entry) => path.resolve(entry.path) === normalizedTarget
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  return lstat(targetPath).then(
    () => true,
    () => false
  );
}

import { lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { StepCtx } from './implement';
import { runGit } from './run-git';

type WorktreePathSafetyError = {
  type: 'unsafe-worktree-path' | 'foreign-worktree';
  message: string;
};

export async function removeStaleWorktreePath(
  targetPath: string,
  ctx: Pick<StepCtx, 'repoPath' | 'worktreePoolPath' | 'signal'>
): Promise<Result<void, WorktreePathSafetyError>> {
  const safe = await validatePoolContainedPathForRemoval(targetPath, ctx);
  if (!safe.success) return safe;

  await rm(targetPath, { recursive: true, force: true });
  return ok();
}

export async function validateWorktreeRemovalTarget(
  targetPath: string,
  ctx: Pick<StepCtx, 'repoPath' | 'worktreePoolPath' | 'signal'>
): Promise<Result<void, WorktreePathSafetyError>> {
  const repositoryOwnership = await belongsToRepository(targetPath, ctx.repoPath, ctx.signal);
  if (repositoryOwnership === 'foreign') {
    return err({
      type: 'foreign-worktree',
      message: `Refusing to remove ${targetPath} because it belongs to another Git repository`,
    });
  }

  // Existing worktrees may predate the current placement policy. Git can safely remove a
  // registered worktree owned by this repository even when it lives in a legacy pool. Raw
  // filesystem deletion remains restricted to the currently declared pool below.
  if (repositoryOwnership === 'same') return ok();

  return validatePoolContainedPathForRemoval(targetPath, ctx);
}

async function validatePoolContainedPathForRemoval(
  targetPath: string,
  ctx: Pick<StepCtx, 'repoPath' | 'worktreePoolPath' | 'signal'>
): Promise<Result<void, WorktreePathSafetyError>> {
  const poolPath = ctx.worktreePoolPath;
  if (!poolPath) {
    return err({
      type: 'unsafe-worktree-path',
      message: `Refusing to remove ${targetPath} without a declared worktree pool`,
    });
  }

  const contained = await isContainedByPool(poolPath, targetPath);
  if (!contained) {
    return err({
      type: 'unsafe-worktree-path',
      message: `Refusing to remove worktree path outside its pool: ${targetPath}`,
    });
  }

  const repositoryOwnership = await belongsToRepository(targetPath, ctx.repoPath, ctx.signal);
  if (repositoryOwnership === 'foreign') {
    return err({
      type: 'foreign-worktree',
      message: `Refusing to remove ${targetPath} because it belongs to another Git repository`,
    });
  }

  return ok();
}

async function isContainedByPool(poolPath: string, targetPath: string): Promise<boolean> {
  const absolutePool = path.resolve(poolPath);
  const absoluteTarget = path.resolve(targetPath);
  if (!isStrictDescendant(absolutePool, absoluteTarget)) return false;

  const [canonicalPool, canonicalTarget] = await Promise.all([
    realpath(absolutePool).catch(() => absolutePool),
    realpath(absoluteTarget).catch(() => absoluteTarget),
  ]);
  return isStrictDescendant(canonicalPool, canonicalTarget);
}

function isStrictDescendant(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function belongsToRepository(
  targetPath: string,
  repoPath: string,
  signal?: AbortSignal
): Promise<'same' | 'foreign' | 'not-git'> {
  const targetExists = await lstat(targetPath).then(
    () => true,
    () => false
  );
  if (!targetExists) return 'not-git';

  const [targetCommonDir, repositoryCommonDir] = await Promise.all([
    gitCommonDir(targetPath, signal),
    gitCommonDir(repoPath, signal),
  ]);
  if (!targetCommonDir) return 'not-git';
  if (!repositoryCommonDir) return 'foreign';

  const [canonicalTarget, canonicalRepository] = await Promise.all([
    realpath(targetCommonDir).catch(() => path.resolve(targetCommonDir)),
    realpath(repositoryCommonDir).catch(() => path.resolve(repositoryCommonDir)),
  ]);
  return canonicalTarget === canonicalRepository ? 'same' : 'foreign';
}

async function gitCommonDir(cwd: string, signal?: AbortSignal): Promise<string | null> {
  const result = await runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    signal,
  });
  return result.success ? result.data.stdout.trim() : null;
}

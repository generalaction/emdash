import type * as Step from '@shared/core/workspaces/workspace-setup-steps/add-worktree';
import { err, ok, type Result } from '@shared/lib/result';
import type { StepContext } from './step-context';

async function isValidWorktree(worktreePath: string, ctx: StepContext): Promise<boolean> {
  const gitFile = ctx.host.pathApi.join(worktreePath, '.git');
  if (ctx.ctx.supportsLocalSpawn) {
    try {
      await ctx.host.existsAbsolute(gitFile);
      return ctx.host.existsAbsolute(gitFile);
    } catch {
      return false;
    }
  }
  return ctx.host.existsAbsolute(gitFile);
}

async function findBranchAnywhere(
  branchName: string,
  ctx: StepContext
): Promise<string | undefined> {
  try {
    const { stdout } = await ctx.ctx.exec('git', ['worktree', 'list', '--porcelain']);
    const branchLine = `branch refs/heads/${branchName}`;
    for (const block of stdout.split('\n\n')) {
      if (!block.split('\n').some((line) => line === branchLine)) continue;
      const match = /^worktree (.+)$/m.exec(block);
      const candidatePath = match?.[1];
      if (!candidatePath) continue;
      if (await isValidWorktree(candidatePath, ctx)) return candidatePath;
      await ctx.ctx.exec('git', ['worktree', 'prune']).catch(() => {});
    }
  } catch {}
  return undefined;
}

export async function execute(
  args: Step.Args,
  ctx: StepContext
): Promise<Result<Step.Success, Step.Error>> {
  const { branchName } = args;
  const targetPath = ctx.host.pathApi.join(ctx.worktreePoolPath, branchName);

  // Check if the branch is already checked out in a valid worktree.
  const existing = await findBranchAnywhere(branchName, ctx);
  if (existing) {
    return ok({ path: existing });
  }

  // Pool directory target exists — check validity.
  if (await ctx.host.existsAbsolute(targetPath)) {
    if (await isValidWorktree(targetPath, ctx)) {
      return ok({ path: targetPath });
    }
    // Stale directory: worktree add will fail unless it's cleaned up first.
    return err({ type: 'stale-directory', path: targetPath });
  }

  // Ensure parent directory exists.
  await ctx.host.mkdirAbsolute(ctx.host.pathApi.dirname(targetPath), { recursive: true });
  await ctx.ctx.exec('git', ['worktree', 'prune']).catch(() => {});

  try {
    await ctx.ctx.exec('git', ['worktree', 'add', targetPath, branchName]);
    return ok({ path: targetPath });
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);

    if (stderr.includes('already checked out') || stderr.includes('is already used by')) {
      // Another worktree has this branch checked out but `findBranchAnywhere` missed it.
      return err({
        type: 'branch-already-checked-out',
        branchName,
        candidatePath: undefined,
      });
    }

    return err({ type: 'worktree-failed', branchName, message: stderr });
  }
}

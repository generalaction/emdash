import type { GitIndexUpdateArgs } from '../../../shared/git/types';

export type UpdateIndexOps = {
  stageAll: () => Promise<void>;
  resetAll: () => Promise<boolean>;
  listStagedPaths: () => Promise<string[]>;
  stagePaths: (filePaths: string[]) => Promise<void>;
  resetPaths: (filePaths: string[]) => Promise<boolean>;
  resetPath: (filePath: string) => Promise<boolean>;
  removePathFromIndex: (filePath: string) => Promise<void>;
};

async function unstagePathsWithFallback(filePaths: string[], ops: UpdateIndexOps): Promise<void> {
  if (filePaths.length <= 0) return;

  if (await ops.resetPaths(filePaths)) {
    return;
  }

  for (const filePath of filePaths) {
    if (await ops.resetPath(filePath)) {
      continue;
    }
    await ops.removePathFromIndex(filePath);
  }
}

export async function updateIndexShared(
  args: GitIndexUpdateArgs,
  ops: UpdateIndexOps
): Promise<void> {
  if (args.scope === 'all') {
    if (args.action === 'stage') {
      await ops.stageAll();
      return;
    }

    if (await ops.resetAll()) {
      return;
    }

    const stagedPaths = await ops.listStagedPaths();
    await unstagePathsWithFallback(stagedPaths, ops);
    return;
  }

  const filePaths = (args.filePaths || []).filter(Boolean);
  if (filePaths.length <= 0) return;

  if (args.action === 'stage') {
    await ops.stagePaths(filePaths);
    return;
  }

  await unstagePathsWithFallback(filePaths, ops);
}

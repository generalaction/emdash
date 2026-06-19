import type { GitChange, GitStatusData, GitStatusModel } from '@emdash/core/git';

export const stageFilesOptimistically = applyToOk(stageFiles);
export const stageAllOptimistically = applyToOk(stageAll);
export const unstageFilesOptimistically = applyToOk(unstageFiles);
export const unstageAllOptimistically = applyToOk(unstageAll);
export const discardFilesOptimistically = applyToOk(removeUnstaged);
export const discardAllOptimistically = applyToOk(removeAllUnstaged);
export const commitOptimistically = applyToOk(clearStaged);

function applyToOk<Args extends unknown[]>(
  fn: (status: GitStatusData, ...args: Args) => GitStatusData
): (model: GitStatusModel, ...args: Args) => GitStatusModel {
  return (model, ...args) => (model.kind === 'ok' ? fn(model, ...args) : model);
}

function stageFiles(status: GitStatusData, paths: string[]): GitStatusData {
  return movePaths(status, paths, 'unstaged', 'staged');
}

function unstageFiles(status: GitStatusData, paths: string[]): GitStatusData {
  return movePaths(status, paths, 'staged', 'unstaged');
}

function stageAll(status: GitStatusData): GitStatusData {
  return recountStaged({
    ...status,
    staged: mergeByPath([...status.staged, ...status.unstaged]),
    unstaged: [],
  });
}

function unstageAll(status: GitStatusData): GitStatusData {
  return {
    ...status,
    staged: [],
    unstaged: mergeByPath([...status.unstaged, ...status.staged]),
    stagedAdded: 0,
    stagedDeleted: 0,
  };
}

function removeUnstaged(status: GitStatusData, paths: string[]): GitStatusData {
  const pathSet = new Set(paths);
  return {
    ...status,
    unstaged: status.unstaged.filter((change) => !pathSet.has(change.path)),
  };
}

function removeAllUnstaged(status: GitStatusData): GitStatusData {
  return {
    ...status,
    unstaged: [],
  };
}

function clearStaged(status: GitStatusData): GitStatusData {
  return {
    ...status,
    staged: [],
    stagedAdded: 0,
    stagedDeleted: 0,
  };
}

function mergeByPath(changes: GitChange[]): GitChange[] {
  const byPath = new Map<string, GitChange>();
  for (const change of changes) {
    byPath.set(change.path, change);
  }
  return [...byPath.values()];
}

function recountStaged(status: GitStatusData): GitStatusData {
  return {
    ...status,
    stagedAdded: status.staged.reduce((sum, change) => sum + change.additions, 0),
    stagedDeleted: status.staged.reduce((sum, change) => sum + change.deletions, 0),
  };
}

function movePaths(
  status: GitStatusData,
  paths: string[],
  from: 'staged' | 'unstaged',
  to: 'staged' | 'unstaged'
): GitStatusData {
  const pathSet = new Set(paths);
  const moving = status[from].filter((change) => pathSet.has(change.path));
  const movingPaths = new Set(moving.map((change) => change.path));
  const nextFrom = status[from].filter((change) => !pathSet.has(change.path));
  const existingTarget = status[to].filter((change) => !movingPaths.has(change.path));
  const next = {
    ...status,
    [from]: nextFrom,
    [to]: [...existingTarget, ...moving],
  };
  return recountStaged(next);
}

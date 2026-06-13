import type { ChangesViewStore, SelectionState } from './changes-view-store';
import type { GitWorktreeStore } from './git-worktree-store';

export function selectUnstagedSelectionState(store: ChangesViewStore): SelectionState {
  return store.unstagedSelectionState;
}

export function selectStagedSelectionState(store: ChangesViewStore): SelectionState {
  return store.stagedSelectionState;
}

export function selectAheadCount(git: GitWorktreeStore): number {
  return git.aheadCount;
}

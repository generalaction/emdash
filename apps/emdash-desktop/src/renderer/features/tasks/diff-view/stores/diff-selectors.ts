import type { GitWorktreeStore } from '../../stores/git-worktree-store';
import type { ChangesViewStore, SelectionState } from './changes-view-store';

export function selectUnstagedSelectionState(store: ChangesViewStore): SelectionState {
  return store.unstagedSelectionState;
}

export function selectStagedSelectionState(store: ChangesViewStore): SelectionState {
  return store.stagedSelectionState;
}

export function selectAheadCount(git: GitWorktreeStore): number {
  return git.aheadCount;
}

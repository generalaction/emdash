import type { ChangesViewStore, SelectionState } from './changes-view-store';
import type { GitStore } from './git-store';

export function selectUnstagedSelectionState(store: ChangesViewStore): SelectionState {
  return store.unstagedSelectionState;
}

export function selectStagedSelectionState(store: ChangesViewStore): SelectionState {
  return store.stagedSelectionState;
}

export function selectAheadCount(git: GitStore): number {
  return git.aheadCount;
}

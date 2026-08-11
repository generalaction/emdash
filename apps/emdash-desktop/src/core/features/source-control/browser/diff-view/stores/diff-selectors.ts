import type { GitCheckoutStore } from '../../stores/git-checkout-store';
import type { ChangesViewStore, SelectionState } from './changes-view-store';

export function selectUnstagedSelectionState(store: ChangesViewStore): SelectionState {
  return store.unstagedSelectionState;
}

export function selectStagedSelectionState(store: ChangesViewStore): SelectionState {
  return store.stagedSelectionState;
}

export function selectAheadCount(git: GitCheckoutStore): number {
  return git.aheadCount;
}

/**
 * Pane selectors for the diff-view domain.
 *
 * These helpers let diff UI read diff-tab state from a generic PaneStore
 * without the engine having to know about DiffTabStore.
 */
import type { PaneStore } from '@renderer/features/tabs/pane-store';
import type { DiffTabStore } from '@renderer/features/tasks/diff-view/stores/diff-tab-store';

export function activeDiffEntry(pane: PaneStore): DiffTabStore | undefined {
  return pane.activeEntryOfKind<DiffTabStore>('diff');
}

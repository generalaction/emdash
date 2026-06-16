/**
 * ViewStateStore — sparse, persistent UI state for chat blocks.
 *
 * Lives outside React so that ephemeral state (e.g. collapsed blocks) survives
 * virtualizer mount/unmount cycles.  Components read from it via the
 * `useCollapsed` hook and write via `toggleCollapsed`.
 */

import { makeAutoObservable, observable } from 'mobx';
import { useLocalObservable } from 'mobx-react-lite';
import { useCallback } from 'react';
import type { BlockId } from '../blocks/block-types';

export class ViewStateStore {
  /** Sparse map: only entries that differ from the default (expanded) are stored. */
  private readonly collapsedMap = observable.map<BlockId, boolean>();

  /**
   * Monotonically increasing version number.  Bumped whenever any collapse state
   * changes so HeightModel can invalidate its item-total cache cheaply.
   */
  collapseVersion = 0;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  isCollapsed(blockId: BlockId): boolean {
    return this.collapsedMap.get(blockId) ?? false;
  }

  toggleCollapsed(blockId: BlockId): void {
    const current = this.collapsedMap.get(blockId) ?? false;
    if (current) {
      this.collapsedMap.delete(blockId);
    } else {
      this.collapsedMap.set(blockId, true);
    }
    this.collapseVersion += 1;
  }

  setCollapsed(blockId: BlockId, value: boolean): void {
    if (!value) {
      this.collapsedMap.delete(blockId);
    } else {
      this.collapsedMap.set(blockId, true);
    }
    this.collapseVersion += 1;
  }

  /** Expand everything (e.g. on "expand all" action). */
  expandAll(): void {
    this.collapsedMap.clear();
    this.collapseVersion += 1;
  }
}

/**
 * Hook that returns the current collapsed state and a stable toggle callback
 * for a given block ID.
 *
 * The store is passed in so callers can share a single instance across
 * components (it lives in ChatTranscript and is passed down).
 */
export function useCollapsed(
  store: ViewStateStore,
  blockId: BlockId
): [collapsed: boolean, toggle: () => void] {
  // Local observable so MobX tracks `isCollapsed(blockId)` at the hook level.
  const state = useLocalObservable(() => ({
    get collapsed() {
      return store.isCollapsed(blockId);
    },
  }));

  const toggle = useCallback(() => {
    store.toggleCollapsed(blockId);
  }, [store, blockId]);

  return [state.collapsed, toggle];
}

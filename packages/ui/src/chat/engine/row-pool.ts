/**
 * RowPool — recycles .pchat-row DOM nodes for the virtualizer.
 *
 * Keeps a map of index -> mounted row and a free list of unmounted rows
 * available for reuse. This avoids GC pressure from creating/destroying
 * large DOM subtrees on every scroll event.
 *
 * Note: because each row's content is rebuilt from geometry on mount,
 * recycled nodes have their children cleared before re-population.
 */

import { el } from '../dom/dom-utils';
import style from '../chat.module.css';

export type MountedRow = {
  /** The .pchat-row container element. */
  node: HTMLElement;
  /** Teardown for island slot mounts (renderIsland/renderCode with slots). */
  dispose: () => void;
  /**
   * True when the row was mounted for a streaming ChatMessage.
   * Used by `_renderVisible` to detect the streaming→done transition and
   * force a remount so the row reflects the final committed content.
   */
  wasStreaming?: boolean;
};

export class RowPool {
  /** Currently mounted rows by item index. */
  private readonly mounted = new Map<number, MountedRow>();
  /** Recycled (unmounted) row containers available for reuse. */
  private readonly free: HTMLElement[] = [];

  // ── Acquire / release ────────────────────────────────────────────────────────

  /**
   * Get a blank .pchat-row element (from the free list or freshly created).
   * Caller populates and mounts it into the canvas.
   */
  acquire(): HTMLElement {
    const node = this.free.pop() ?? el('div', { className: style['pchat-row'] });
    // Clear any previous content
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Register a mounted row at index. */
  register(index: number, row: MountedRow): void {
    this.mounted.set(index, row);
  }

  /**
   * Unmount the row at index (if mounted): call dispose(), remove from DOM,
   * and put the container in the free list for reuse.
   */
  unmount(index: number): void {
    const row = this.mounted.get(index);
    if (!row) return;
    row.dispose();
    if (row.node.parentNode) row.node.parentNode.removeChild(row.node);
    // Clear children before recycling
    while (row.node.firstChild) row.node.removeChild(row.node.firstChild);
    this.free.push(row.node);
    this.mounted.delete(index);
  }

  /** True if index is currently mounted. */
  has(index: number): boolean {
    return this.mounted.has(index);
  }

  get(index: number): MountedRow | undefined {
    return this.mounted.get(index);
  }

  /** Returns the set of currently mounted indices. */
  mountedIndices(): IterableIterator<number> {
    return this.mounted.keys();
  }

  /** Unmount all rows; call before engine.dispose(). */
  disposeAll(): void {
    for (const index of [...this.mounted.keys()]) {
      this.unmount(index);
    }
    this.free.length = 0;
  }
}

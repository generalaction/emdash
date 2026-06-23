import { action, computed, makeObservable, observable, reaction } from 'mobx';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { PaneStore } from '@renderer/features/tasks/tabs/pane-store';
import type { TabGroupsSnapshot } from '@shared/view-state';
import type { TabKind, OpenArgsOf } from './providers';

const MAX_PANE_COUNT = 8;

export interface Pane {
  paneId: string;
  pane: PaneStore;
}

/**
 * Owns the ordered array of per-pane PaneStore instances, the active
 * pane, and the pane size layout.
 *
 * Each pane is an independent tab manager. The focused pane is exposed via
 * the `focusedPane` getter so callers that only care about the active
 * pane continue to work without change.
 */
export class PaneLayoutStore {
  readonly groups: Pane[] = [];
  activePaneId: string;
  paneSizes: number[];

  private readonly _getConversations: () => ConversationManagerStore | null;
  private readonly _workspaceId: string;
  private readonly _projectId: string;
  private readonly _taskId: string;
  /** Disposers for the per-group auto-close reactions. Not observable. */
  private readonly _autoCloseDisposers = new Map<string, () => void>();

  constructor(
    getConversations: () => ConversationManagerStore | null,
    workspaceId: string,
    projectId: string,
    taskId: string
  ) {
    this._getConversations = getConversations;
    this._workspaceId = workspaceId;
    this._projectId = projectId;
    this._taskId = taskId;

    const initial = this._createPane();
    this.groups.push(initial);
    this.activePaneId = initial.paneId;
    this.paneSizes = [100];

    makeObservable(this, {
      groups: observable,
      activePaneId: observable,
      paneSizes: observable,
      focusedPane: computed,
      allOpenFilePaths: computed,
      splitRight: action,
      openConversationInRightSplit: action,
      closePane: action,
      moveTab: action,
      handleDragEnd: action,
      setActiveGroup: action,
      setPaneSizes: action,
      restoreSnapshot: action,
      open: action,
    });
  }

  get focusedPane(): PaneStore {
    return this.groups.find((g) => g.paneId === this.activePaneId)?.pane ?? this.groups[0].pane;
  }

  get allOpenFilePaths(): string[] {
    const seen = new Set<string>();
    for (const { pane } of this.groups) {
      for (const path of pane.openFilePaths) {
        seen.add(path);
      }
    }
    return [...seen];
  }

  splitRight(): void {
    if (this.groups.length >= MAX_PANE_COUNT) return;

    const focusedIndex = this.groups.findIndex((g) => g.paneId === this.activePaneId);
    const sourceGroup = this.groups[focusedIndex === -1 ? 0 : focusedIndex];

    if (sourceGroup.pane.tabOrder.length < 2) return;
    const activeTabId = sourceGroup.pane.resolvedActiveTabId;
    if (!activeTabId) return;

    const newGroup = this._createPane();
    const insertAt = focusedIndex === -1 ? this.groups.length : focusedIndex + 1;
    this.groups.splice(insertAt, 0, newGroup);
    this._redistributeSizes();

    // Move (not copy) — moveTab handles remove-from-source, insert-into-target,
    // and sets activePaneId = newGroup.paneId.
    this.moveTab(activeTabId, sourceGroup.paneId, newGroup.paneId);
  }

  openConversationInRightSplit(conversationId: string): void {
    if (this.groups.length >= MAX_PANE_COUNT) {
      this.open('conversation', { conversationId, preview: false });
      return;
    }

    const focusedIndex = this.groups.findIndex((g) => g.paneId === this.activePaneId);
    const insertAt = focusedIndex === -1 ? this.groups.length : focusedIndex + 1;
    const newGroup = this._createPane();

    this.groups.splice(insertAt, 0, newGroup);
    this._redistributeSizes();
    this.activePaneId = newGroup.paneId;
    newGroup.pane.open('conversation', { conversationId, preview: false });
  }

  /**
   * Closes the given pane. The adjacent pane (preferring right, fallback left)
   * becomes active.
   */
  closePane(paneId: string): void {
    if (this.groups.length <= 1) return;

    const index = this.groups.findIndex((g) => g.paneId === paneId);
    if (index === -1) return;

    const closing = this.groups[index];
    const adjacentIndex = index < this.groups.length - 1 ? index + 1 : index - 1;
    const adjacent = this.groups[adjacentIndex];

    // Clean up the auto-close reaction before disposing.
    this._autoCloseDisposers.get(paneId)?.();
    this._autoCloseDisposers.delete(paneId);

    // Dispose the closing pane's store.
    closing.pane.dispose();

    this.groups.splice(index, 1);
    this._redistributeSizes();

    if (this.activePaneId === paneId) {
      this.activePaneId = adjacent.paneId;
    }
  }

  moveTab(tabId: string, fromPaneId: string, toPaneId: string, insertBeforeTabId?: string): void {
    if (fromPaneId === toPaneId) return;
    const fromGroup = this.groups.find((g) => g.paneId === fromPaneId);
    const toGroup = this.groups.find((g) => g.paneId === toPaneId);
    if (!fromGroup || !toGroup) return;
    const entry = fromGroup.pane.detachTab(tabId);
    if (!entry) return;

    // Insert into target, reusing the same entry object and tabId.
    toGroup.pane.entries.set(tabId, entry);
    const insertIdx = insertBeforeTabId ? toGroup.pane.tabOrder.indexOf(insertBeforeTabId) : -1;
    if (insertIdx === -1) {
      toGroup.pane.tabOrder.push(tabId);
    } else {
      toGroup.pane.tabOrder.splice(insertIdx, 0, tabId);
    }
    toGroup.pane.activeTabId = tabId;
    this.activePaneId = toPaneId;
  }

  handleDragEnd(draggedTabId: string, overId: string): void {
    const fromGroup = this.groups.find((g) => g.pane.entries.has(draggedTabId));
    if (!fromGroup) return;

    let toPaneId: string | undefined;
    if (overId.startsWith('pane-drop-') || overId.startsWith('pane-content-')) {
      toPaneId = overId.startsWith('pane-drop-')
        ? overId.slice('pane-drop-'.length)
        : overId.slice('pane-content-'.length);
    } else {
      toPaneId = this.groups.find((g) => g.pane.entries.has(overId))?.paneId;
    }

    if (!toPaneId || toPaneId === fromGroup.paneId) {
      const fromTabIds = fromGroup.pane.resolvedTabs.map((t) => t.tabId);
      const fromIdx = fromTabIds.indexOf(draggedTabId);
      if (fromIdx === -1) return;
      // pane-drop-* / pane-content-* means dropped over empty space or renderer → move to end
      const toIdx =
        overId.startsWith('pane-drop-') || overId.startsWith('pane-content-')
          ? fromTabIds.length - 1
          : fromTabIds.indexOf(overId);
      if (toIdx !== -1) fromGroup.pane.reorderTabs(fromIdx, toIdx);
      return;
    }

    // When overId is a specific tab (not a pane-drop/pane-content fallback), insert before it.
    const insertBeforeTabId =
      overId.startsWith('pane-drop-') || overId.startsWith('pane-content-') ? undefined : overId;
    this.moveTab(draggedTabId, fromGroup.paneId, toPaneId, insertBeforeTabId);
  }

  setActiveGroup(paneId: string): void {
    if (this.groups.some((g) => g.paneId === paneId)) {
      this.activePaneId = paneId;
    }
  }

  setPaneSizes(sizes: number[]): void {
    if (sizes.length === this.groups.length) {
      this.paneSizes = sizes;
    }
  }

  open<K extends TabKind>(kind: K, args: OpenArgsOf<K>): void {
    if (kind === 'conversation') {
      const convArgs = args as { conversationId: string; preview?: boolean };
      for (const { paneId, pane } of this.groups) {
        if (pane.hasConversationTab(convArgs.conversationId)) {
          this.activePaneId = paneId;
          pane.open(kind, args);
          return;
        }
      }
    }
    this.focusedPane.open(kind, args);
  }

  get snapshot(): TabGroupsSnapshot {
    return {
      groups: this.groups.map((g) => ({
        // Keep persisted field names stable (groupId / tabManager) for DB compatibility.
        groupId: g.paneId,
        tabManager: g.pane.snapshot,
      })),
      activeGroupId: this.activePaneId,
      paneSizes: [...this.paneSizes],
    };
  }

  restoreSnapshot(snapshot: TabGroupsSnapshot): void {
    // Dispose any existing groups beyond the first.
    for (let i = 1; i < this.groups.length; i++) {
      this.groups[i].pane.dispose();
    }
    this.groups.splice(0, this.groups.length);

    for (const g of snapshot.groups) {
      const pane = this._createPaneStore(g.groupId);
      pane.restoreSnapshot(g.tabManager);
      this.groups.push({ paneId: g.groupId, pane });
      this._registerAutoClose(g.groupId, pane);
    }

    this.activePaneId = snapshot.groups.some((g) => g.groupId === snapshot.activeGroupId)
      ? snapshot.activeGroupId
      : (snapshot.groups[0]?.groupId ?? this.activePaneId);

    this.paneSizes =
      snapshot.paneSizes.length === snapshot.groups.length
        ? [...snapshot.paneSizes]
        : this._evenSizes(snapshot.groups.length);
  }

  dispose(): void {
    for (const disposer of this._autoCloseDisposers.values()) {
      disposer();
    }
    this._autoCloseDisposers.clear();
    for (const { pane } of this.groups) {
      pane.dispose();
    }
  }

  private _createPane(): Pane {
    const paneId = crypto.randomUUID();
    const pane = this._createPaneStore(paneId);
    this._registerAutoClose(paneId, pane);
    return { paneId, pane };
  }

  private _createPaneStore(_paneId: string): PaneStore {
    const store = new PaneStore(
      this._getConversations,
      this._workspaceId,
      this._projectId,
      this._taskId
    );
    return store;
  }

  /**
   * Registers a MobX reaction that auto-closes the pane when it becomes empty
   * and at least one other pane exists.
   *
   * Fires only after the enclosing action completes, so splitRight() (which opens
   * a tab in the same action) won't trigger a false auto-close.
   */
  private _registerAutoClose(paneId: string, pane: PaneStore): void {
    const disposer = reaction(
      () => pane.tabOrder.length,
      (length) => {
        if (length === 0 && this.groups.length > 1) {
          this.closePane(paneId);
        }
      }
    );
    this._autoCloseDisposers.set(paneId, disposer);
  }

  private _redistributeSizes(): void {
    this.paneSizes = this._evenSizes(this.groups.length);
  }

  private _evenSizes(count: number): number[] {
    const size = Math.floor(100 / count);
    const sizes = new Array<number>(count).fill(size);
    // Add any rounding remainder to the first pane.
    sizes[0] += 100 - sizes.reduce((a, b) => a + b, 0);
    return sizes;
  }
}

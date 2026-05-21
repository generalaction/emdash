import { action, computed, makeObservable, observable, reaction } from 'mobx';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import type { TabGroupsSnapshot } from '@shared/view-state';

const MAX_PANE_COUNT = 8;

export interface TabGroupEntry {
  groupId: string;
  tabManager: TabManagerStore;
}

/**
 * Owns the ordered array of per-pane TabManagerStore instances, the active
 * group, and the pane size layout.
 *
 * Each group is an independent tab manager. The focused group is exposed via
 * the `focusedGroup` getter so existing callers that only care about the active
 * pane continue to work without change.
 *
 * The close handler registered by FileModelLifecycleStore is propagated to
 * all current and future groups via `registerCloseHandler`.
 */
export class TabGroupManagerStore {
  readonly groups: TabGroupEntry[] = [];
  activeGroupId: string;
  paneSizes: number[];

  private readonly _getConversations: () => ConversationManagerStore | null;
  private readonly _workspaceId: string;
  private _closeHandler?: (tabId: string) => Promise<void>;
  /** Disposers for the per-group auto-close reactions. Not observable. */
  private readonly _autoCloseDisposers = new Map<string, () => void>();

  constructor(getConversations: () => ConversationManagerStore | null, workspaceId: string) {
    this._getConversations = getConversations;
    this._workspaceId = workspaceId;

    const initial = this._createGroup();
    this.groups.push(initial);
    this.activeGroupId = initial.groupId;
    this.paneSizes = [100];

    makeObservable(this, {
      groups: observable,
      activeGroupId: observable,
      paneSizes: observable,
      focusedGroup: computed,
      allOpenFilePaths: computed,
      registerCloseHandler: action,
      splitRight: action,
      closeGroup: action,
      moveTab: action,
      handleDragEnd: action,
      setActiveGroup: action,
      setPaneSizes: action,
      restoreSnapshot: action,
      openConversation: action,
      openConversationPreview: action,
    });
  }

  get focusedGroup(): TabManagerStore {
    return (
      this.groups.find((g) => g.groupId === this.activeGroupId)?.tabManager ??
      this.groups[0].tabManager
    );
  }

  get allOpenFilePaths(): string[] {
    const seen = new Set<string>();
    for (const { tabManager } of this.groups) {
      for (const path of tabManager.openFilePaths) {
        seen.add(path);
      }
    }
    return [...seen];
  }

  registerCloseHandler(handler: (tabId: string) => Promise<void>): void {
    this._closeHandler = handler;
    for (const { tabManager } of this.groups) {
      tabManager.registerCloseHandler(handler);
    }
  }

  splitRight(): void {
    if (this.groups.length >= MAX_PANE_COUNT) return;

    const focusedIndex = this.groups.findIndex((g) => g.groupId === this.activeGroupId);
    const sourceGroup = this.groups[focusedIndex === -1 ? 0 : focusedIndex];

    if (sourceGroup.tabManager.tabOrder.length < 2) return;
    const activeTabId = sourceGroup.tabManager.resolvedActiveTabId;
    if (!activeTabId) return;

    const newGroup = this._createGroup();
    const insertAt = focusedIndex === -1 ? this.groups.length : focusedIndex + 1;
    this.groups.splice(insertAt, 0, newGroup);
    this._redistributeSizes();

    // Move (not copy) — moveTab handles remove-from-source, insert-into-target,
    // and sets activeGroupId = newGroup.groupId.
    this.moveTab(activeTabId, sourceGroup.groupId, newGroup.groupId);
  }

  /**
   * Closes the given group. The adjacent group (preferring right, fallback left)
   * becomes active.
   */
  closeGroup(groupId: string): void {
    if (this.groups.length <= 1) return;

    const index = this.groups.findIndex((g) => g.groupId === groupId);
    if (index === -1) return;

    const closing = this.groups[index];
    const adjacentIndex = index < this.groups.length - 1 ? index + 1 : index - 1;
    const adjacent = this.groups[adjacentIndex];

    // Clean up the auto-close reaction before disposing.
    this._autoCloseDisposers.get(groupId)?.();
    this._autoCloseDisposers.delete(groupId);

    // Dispose the closing group's tab manager.
    closing.tabManager.dispose();

    this.groups.splice(index, 1);
    this._redistributeSizes();

    if (this.activeGroupId === groupId) {
      this.activeGroupId = adjacent.groupId;
    }
  }

  moveTab(tabId: string, fromGroupId: string, toGroupId: string, insertBeforeTabId?: string): void {
    if (fromGroupId === toGroupId) return;
    const fromGroup = this.groups.find((g) => g.groupId === fromGroupId);
    const toGroup = this.groups.find((g) => g.groupId === toGroupId);
    if (!fromGroup || !toGroup) return;
    const entry = fromGroup.tabManager.entries.get(tabId);
    if (!entry) return;

    // Force-remove from source without triggering the close guard.
    fromGroup.tabManager.closeTab(tabId);

    // Insert into target, reusing the same entry object and tabId.
    toGroup.tabManager.entries.set(tabId, entry);
    const insertIdx = insertBeforeTabId
      ? toGroup.tabManager.tabOrder.indexOf(insertBeforeTabId)
      : -1;
    if (insertIdx === -1) {
      toGroup.tabManager.tabOrder.push(tabId);
    } else {
      toGroup.tabManager.tabOrder.splice(insertIdx, 0, tabId);
    }
    toGroup.tabManager.activeTabId = tabId;
    this.activeGroupId = toGroupId;
  }

  handleDragEnd(draggedTabId: string, overId: string): void {
    const fromGroup = this.groups.find((g) => g.tabManager.entries.has(draggedTabId));
    if (!fromGroup) return;

    let toGroupId: string | undefined;
    if (overId.startsWith('pane-drop-') || overId.startsWith('pane-content-')) {
      toGroupId = overId.startsWith('pane-drop-')
        ? overId.slice('pane-drop-'.length)
        : overId.slice('pane-content-'.length);
    } else {
      toGroupId = this.groups.find((g) => g.tabManager.entries.has(overId))?.groupId;
    }

    if (!toGroupId || toGroupId === fromGroup.groupId) {
      const fromTabIds = fromGroup.tabManager.resolvedTabs.map((t) => t.tabId);
      const fromIdx = fromTabIds.indexOf(draggedTabId);
      if (fromIdx === -1) return;
      // pane-drop-* / pane-content-* means dropped over empty space or renderer → move to end
      const toIdx =
        overId.startsWith('pane-drop-') || overId.startsWith('pane-content-')
          ? fromTabIds.length - 1
          : fromTabIds.indexOf(overId);
      if (toIdx !== -1) fromGroup.tabManager.reorderTabs(fromIdx, toIdx);
      return;
    }

    // When overId is a specific tab (not a pane-drop/pane-content fallback), insert before it.
    const insertBeforeTabId =
      overId.startsWith('pane-drop-') || overId.startsWith('pane-content-') ? undefined : overId;
    this.moveTab(draggedTabId, fromGroup.groupId, toGroupId, insertBeforeTabId);
  }

  setActiveGroup(groupId: string): void {
    if (this.groups.some((g) => g.groupId === groupId)) {
      this.activeGroupId = groupId;
    }
  }

  setPaneSizes(sizes: number[]): void {
    if (sizes.length === this.groups.length) {
      this.paneSizes = sizes;
    }
  }

  openConversation(conversationId: string): void {
    for (const { groupId, tabManager } of this.groups) {
      if (tabManager.hasConversationTab(conversationId)) {
        this.activeGroupId = groupId;
        tabManager.openConversation(conversationId);
        return;
      }
    }
    this.focusedGroup.openConversation(conversationId);
  }

  openConversationPreview(conversationId: string): void {
    for (const { groupId, tabManager } of this.groups) {
      if (tabManager.hasConversationTab(conversationId)) {
        this.activeGroupId = groupId;
        tabManager.openConversationPreview(conversationId);
        return;
      }
    }
    this.focusedGroup.openConversationPreview(conversationId);
  }

  get snapshot(): TabGroupsSnapshot {
    return {
      groups: this.groups.map((g) => ({
        groupId: g.groupId,
        tabManager: g.tabManager.snapshot,
      })),
      activeGroupId: this.activeGroupId,
      paneSizes: [...this.paneSizes],
    };
  }

  restoreSnapshot(snapshot: TabGroupsSnapshot): void {
    // Dispose any existing groups beyond the first.
    for (let i = 1; i < this.groups.length; i++) {
      this.groups[i].tabManager.dispose();
    }
    this.groups.splice(0, this.groups.length);

    for (const g of snapshot.groups) {
      const tabManager = this._createTabManager(g.groupId);
      tabManager.restoreSnapshot(g.tabManager);
      this.groups.push({ groupId: g.groupId, tabManager });
      this._registerAutoClose(g.groupId, tabManager);
    }

    this.activeGroupId = snapshot.groups.some((g) => g.groupId === snapshot.activeGroupId)
      ? snapshot.activeGroupId
      : (snapshot.groups[0]?.groupId ?? this.activeGroupId);

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
    for (const { tabManager } of this.groups) {
      tabManager.dispose();
    }
  }

  private _createGroup(): TabGroupEntry {
    const groupId = crypto.randomUUID();
    const tabManager = this._createTabManager(groupId);
    this._registerAutoClose(groupId, tabManager);
    return { groupId, tabManager };
  }

  private _createTabManager(_groupId: string): TabManagerStore {
    const store = new TabManagerStore(this._getConversations, this._workspaceId);
    if (this._closeHandler) {
      store.registerCloseHandler(this._closeHandler);
    }
    return store;
  }

  /**
   * Registers a MobX reaction that auto-closes the pane when it becomes empty
   * and at least one other pane exists.
   *
   * Fires only after the enclosing action completes, so splitRight() (which opens
   * a tab in the same action) won't trigger a false auto-close.
   */
  private _registerAutoClose(groupId: string, tabManager: TabManagerStore): void {
    const disposer = reaction(
      () => tabManager.tabOrder.length,
      (length) => {
        if (length === 0 && this.groups.length > 1) {
          this.closeGroup(groupId);
        }
      }
    );
    this._autoCloseDisposers.set(groupId, disposer);
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

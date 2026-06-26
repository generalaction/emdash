import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { PaneStore } from '@renderer/features/tabs/pane-store';
import type { TabGroupsSnapshot } from '@shared/view-state';
import type { TabViewContext } from './core/tab-provider';
import type { KindOf, OpenArgsOf, TabRegistry } from './core/tab-provider-registry';
import type { TabPersistenceAdapter } from './persistence';

const MAX_PANE_COUNT = 8;

export interface Pane<R extends TabRegistry = TabRegistry> {
  paneId: string;
  pane: PaneStore<R>;
}

/**
 * Owns the ordered array of per-pane PaneStore instances, the active
 * pane, and the pane size layout.
 *
 * Cross-pane concerns handled here:
 * - mount:'single' cardinality — at most one tab per resourceKey across ALL panes
 * - Tab move (detachTab + adoptEntry) — resource survives unchanged, no lifecycle calls
 */
export class PaneLayoutStore<R extends TabRegistry = TabRegistry> {
  readonly groups: Pane<R>[] = [];
  activePaneId: string;
  paneSizes: number[];

  private readonly _registry: R;
  private readonly _ctx: TabViewContext;
  private readonly _persistor: TabPersistenceAdapter | undefined;
  private _persistDisposer: (() => void) | null = null;
  private readonly _autoCloseDisposers = new Map<string, () => void>();

  constructor(registry: R, ctx: TabViewContext, persistor?: TabPersistenceAdapter) {
    this._registry = registry;
    this._ctx = ctx;
    this._persistor = persistor;

    const initial = this._createPane();
    this.groups.push(initial);
    this.activePaneId = initial.paneId;
    this.paneSizes = [100];

    makeObservable(this, {
      groups: observable,
      activePaneId: observable,
      paneSizes: observable,
      focusedPane: computed,
      splitRight: action,
      openInRightSplit: action,
      closePane: action,
      moveTab: action,
      handleDragEnd: action,
      setActiveGroup: action,
      setPaneSizes: action,
      restoreSnapshot: action,
      open: action,
    });
  }

  get focusedPane(): PaneStore<R> {
    return this.groups.find((g) => g.paneId === this.activePaneId)?.pane ?? this.groups[0].pane;
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

    this.moveTab(activeTabId, sourceGroup.paneId, newGroup.paneId);
  }

  /**
   * Opens a tab in a new pane to the right of the focused pane.
   * Routes through the same single-mount cardinality guard as open().
   * Falls back to opening in the focused pane when at max pane count.
   */
  openInRightSplit<K extends KindOf<R>>(kind: K, args: OpenArgsOf<R, K>): void {
    // Route through cardinality guard first.
    if (this._focusExistingSingleMount(kind as string, args as Record<string, unknown>)) return;

    if (this.groups.length >= MAX_PANE_COUNT) {
      this.open(kind, args);
      return;
    }

    const focusedIndex = this.groups.findIndex((g) => g.paneId === this.activePaneId);
    const insertAt = focusedIndex === -1 ? this.groups.length : focusedIndex + 1;
    const newGroup = this._createPane();

    this.groups.splice(insertAt, 0, newGroup);
    this._redistributeSizes();
    this.activePaneId = newGroup.paneId;
    newGroup.pane.open(kind, args);
  }

  closePane(paneId: string): void {
    if (this.groups.length <= 1) return;

    const index = this.groups.findIndex((g) => g.paneId === paneId);
    if (index === -1) return;

    const closing = this.groups[index];
    const adjacentIndex = index < this.groups.length - 1 ? index + 1 : index - 1;
    const adjacent = this.groups[adjacentIndex];

    this._autoCloseDisposers.get(paneId)?.();
    this._autoCloseDisposers.delete(paneId);

    closing.pane.dispose();

    this.groups.splice(index, 1);
    this._redistributeSizes();

    if (this.activePaneId === paneId) {
      this.activePaneId = adjacent.paneId;
    }
  }

  /**
   * Moves a tab between panes by detaching it (no dispose) and adopting it
   * in the target pane (no initialize). The resource instance is unchanged.
   */
  moveTab(tabId: string, fromPaneId: string, toPaneId: string, insertBeforeTabId?: string): void {
    if (fromPaneId === toPaneId) return;
    const fromGroup = this.groups.find((g) => g.paneId === fromPaneId);
    const toGroup = this.groups.find((g) => g.paneId === toPaneId);
    if (!fromGroup || !toGroup) return;

    const detached = fromGroup.pane.detachTab(tabId);
    if (!detached) return;

    toGroup.pane.adoptEntry(detached.entry, detached.resource, {
      insertBeforeTabId,
      activate: true,
    });
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
      const toIdx =
        overId.startsWith('pane-drop-') || overId.startsWith('pane-content-')
          ? fromTabIds.length - 1
          : fromTabIds.indexOf(overId);
      if (toIdx !== -1) fromGroup.pane.reorderTabs(fromIdx, toIdx);
      return;
    }

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

  /**
   * Opens a tab in the focused pane, enforcing single-mount cardinality for
   * providers with mount:'single' by focusing the existing tab/pane instead.
   */
  open<K extends KindOf<R>>(kind: K, args: OpenArgsOf<R, K>): void {
    if (this._focusExistingSingleMount(kind as string, args as Record<string, unknown>)) return;
    this.focusedPane.open(kind, args);
  }

  get snapshot(): TabGroupsSnapshot {
    return {
      groups: this.groups.map((g) => ({
        groupId: g.paneId,
        tabManager: g.pane.snapshot,
      })),
      activeGroupId: this.activePaneId,
      paneSizes: [...this.paneSizes],
    };
  }

  restoreSnapshot(snapshot: TabGroupsSnapshot): void {
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

  hydrate(fallback?: unknown): boolean {
    const saved = this._persistor?.load(fallback);
    if (saved) {
      this.restoreSnapshot(saved);
      return true;
    }
    return false;
  }

  startPersistence(): void {
    if (!this._persistor) return;
    this._persistDisposer?.();
    this._persistDisposer = this._persistor.start(() => this.snapshot);
  }

  stopPersistence(): void {
    this._persistDisposer?.();
    this._persistDisposer = null;
  }

  dispose(): void {
    this.stopPersistence();
    for (const disposer of this._autoCloseDisposers.values()) {
      disposer();
    }
    this._autoCloseDisposers.clear();
    for (const { pane } of this.groups) {
      pane.dispose();
    }
  }

  /**
   * If the provider is single-mount and a tab for the given key already exists
   * in any pane, focus that pane+tab and return true. Otherwise return false.
   */
  private _focusExistingSingleMount(kind: string, args: Record<string, unknown>): boolean {
    if (!this._registry.has(kind)) return false;
    const def = this._registry.get(kind);
    if ((def.mount ?? 'multi') !== 'single') return false;

    const { preview: _preview, ...rest } = args;
    const payload: unknown = def.onBeforeOpen
      ? def.onBeforeOpen(args as never, this._ctx)
      : (rest as unknown);
    if (payload === null) return true; // aborted

    const key = def.resourceKey(payload as never);
    for (const g of this.groups) {
      const existing = g.pane.entryByKey(kind, key);
      if (existing) {
        this.setActiveGroup(g.paneId);
        g.pane.setActiveTab(existing.tabId);
        if (!args['preview']) existing.isPreview = false;
        return true;
      }
    }
    return false;
  }

  private _createPane(): Pane<R> {
    const paneId = crypto.randomUUID();
    const pane = this._createPaneStore(paneId);
    this._registerAutoClose(paneId, pane);
    return { paneId, pane };
  }

  private _createPaneStore(_paneId: string): PaneStore<R> {
    return new PaneStore<R>(this._registry, this._ctx);
  }

  private _registerAutoClose(paneId: string, pane: PaneStore<R>): void {
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
    sizes[0] += 100 - sizes.reduce((a, b) => a + b, 0);
    return sizes;
  }
}

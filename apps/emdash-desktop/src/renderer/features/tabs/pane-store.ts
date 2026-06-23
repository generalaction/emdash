import { action, computed, makeObservable, observable } from 'mobx';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import {
  addTabId,
  removeTabId,
  reorderTabIds,
  setNextTabActive as tabUtilsSetNextTabActive,
  setPreviousTabActive as tabUtilsSetPreviousTabActive,
  setTabActiveIndex as tabUtilsSetTabActiveIndex,
} from '@renderer/lib/stores/tab-utils';
import type { TabDescriptor, TabManagerSnapshot } from '@shared/view-state';
import type { TabEntryBase, TabHost, TabKindContext, ResolvedTab } from './core/tab-provider';
import { tabProviderRegistry } from './core/tab-provider-registry';
import type { TabKind, OpenArgsOf } from './providers';

/**
 * Owns all tab open/close/order/active state for a single pane.
 * Entity-specific state lives in the domain entry classes (FileTabStore, DiffTabStore,
 * ConversationTabEntry, …). Monaco model registration is handled by FileModelLifecycleStore.
 */
export class PaneStore implements Snapshottable<TabManagerSnapshot>, TabHost {
  /** All open tab entries keyed by tabId. O(1) lookup; finer-grained MobX reactivity. */
  readonly entries = observable.map<string, TabEntryBase>();
  /** Tab display order (array of tabIds). Drives resolvedTabs. */
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;
  isVisible = false;
  /** True when this pane is the active/focused pane AND the task is the active view. */
  isFocused = false;

  /** Used by resolvedTabs and FileModelLifecycleStore to build buffer URIs. */
  readonly modelRootPath: string;

  private readonly _projectId: string;
  private readonly _workspaceId: string;
  private readonly _taskId: string;
  private readonly disposers: (() => void)[] = [];
  /** Stable context object passed to TabProvider methods. Never changes after construction. */
  private readonly _ctx: TabKindContext;
  /** Bounded stack of recently closed tabs for reopening. Not observable — not persisted. */
  private readonly _closedTabHistory: Array<{ data: TabDescriptor; index: number }> = [];
  private static readonly _MAX_CLOSED_HISTORY = 20;
  get ctx(): TabKindContext {
    return this._ctx;
  }

  constructor(workspaceId: string, projectId: string, taskId: string) {
    this._projectId = projectId;
    this._workspaceId = workspaceId;
    this._taskId = taskId;
    this.modelRootPath = `workspace:${workspaceId}`;
    this._ctx = { projectId, workspaceId, taskId, modelRootPath: this.modelRootPath };

    makeObservable(this, {
      tabOrder: observable,
      activeTabId: observable,
      isVisible: observable,
      isFocused: observable,
      resolvedActiveTabId: computed,
      activeEntry: computed,
      resolvedTabs: computed,
      snapshot: computed,
      open: action,
      openKind: action,
      replaceEntry: action,
      closeTab: action,
      closeActiveTab: action,
      setActiveTab: action,
      reorderTabs: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      setVisible: action,
      setFocused: action,
      pin: action,
      attachEntry: action,
      closeOthers: action,
      requestCloseTab: action,
      reopenClosedTab: action,
      restoreSnapshot: action,
      detachTab: action,
    });

    // Call mount lifecycle for each registered tab kind.
    // Each def.mount returns a disposer that is pushed to this.disposers.
    for (const def of tabProviderRegistry.all()) {
      if (def.mount) {
        this.disposers.push(def.mount(this, this._ctx));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  /**
   * The effective active tab ID: the stored `activeTabId` when it points to an
   * existing entry, otherwise the first tab in order. This makes the invariant
   * "tabs exist → one is active" hold even when the stored value is stale or absent.
   */
  get resolvedActiveTabId(): string | undefined {
    if (this.activeTabId && this.entries.has(this.activeTabId)) {
      return this.activeTabId;
    }
    return this.tabOrder[0];
  }

  // ---------------------------------------------------------------------------
  // Generic entry accessors — kind-agnostic surface for domain consumers
  // ---------------------------------------------------------------------------

  /** The currently active entry, regardless of kind. */
  get activeEntry(): TabEntryBase | undefined {
    return this.entries.get(this.resolvedActiveTabId ?? '');
  }

  /** All entries of the given kind, in tab-order. Type-cast by caller. */
  entriesOfKind<E extends TabEntryBase>(kind: string): E[] {
    const result: E[] = [];
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === kind) result.push(entry as unknown as E);
    }
    return result;
  }

  /** The active entry if it matches the given kind, otherwise undefined. */
  activeEntryOfKind<E extends TabEntryBase>(kind: string): E | undefined {
    const entry = this.activeEntry;
    return entry?.kind === kind ? (entry as unknown as E) : undefined;
  }

  get resolvedTabs(): ResolvedTab[] {
    const result: ResolvedTab[] = [];
    const effectiveActiveId = this.resolvedActiveTabId;
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (!entry || !tabProviderRegistry.has(entry.kind)) continue;
      const def = tabProviderRegistry.get(entry.kind);
      const isActive = effectiveActiveId === entry.tabId;
      const rd = def.resolve(entry, { ...this._ctx, isActive });
      if (!rd) continue;
      result.push({
        kind: entry.kind,
        tabId: entry.tabId,
        isPreview: entry.isPreview,
        isActive,
        ...rd,
      } as ResolvedTab);
    }
    return result;
  }

  get snapshot(): TabManagerSnapshot {
    const tabs: TabDescriptor[] = [];
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (!entry || !tabProviderRegistry.has(entry.kind)) continue;
      const data = tabProviderRegistry.get(entry.kind).serialize(entry);
      if (data !== null) tabs.push(data as unknown as TabDescriptor);
    }
    return { tabs, activeTabId: this.activeTabId };
  }

  // ---------------------------------------------------------------------------
  // Actions — open
  // ---------------------------------------------------------------------------

  open<K extends TabKind>(kind: K, args: OpenArgsOf<K>): void {
    const def = tabProviderRegistry.get(kind);
    if (!def) {
      console.warn(`[PaneStore] Unknown tab kind: ${kind}`);
      return;
    }
    def.open(args as never, this, this._ctx);
  }

  openKind(kind: string, args: unknown): void {
    if (!tabProviderRegistry.has(kind)) {
      console.warn(`[PaneStore] Unknown tab kind: ${kind}`);
      return;
    }
    tabProviderRegistry.get(kind).open(args as never, this, this._ctx);
  }

  replaceEntry(
    existingTabId: string,
    newEntry: { readonly kind: string; readonly tabId: string; isPreview: boolean },
    opts?: { activate?: boolean }
  ): void {
    const idx = this.tabOrder.indexOf(existingTabId);
    if (idx === -1) {
      this.attachEntry(newEntry, opts);
      return;
    }
    // Call onClose for replaced entry.
    const old = this.entries.get(existingTabId);
    if (old && tabProviderRegistry.has(old.kind)) {
      tabProviderRegistry.get(old.kind).onClose?.(old, this._ctx);
    }
    this.entries.delete(existingTabId);
    this.entries.set(newEntry.tabId, newEntry as TabEntryBase);
    this.tabOrder.splice(idx, 1, newEntry.tabId);
    if (opts?.activate ?? true) this.activeTabId = newEntry.tabId;
  }

  // ---------------------------------------------------------------------------
  // Actions — closing / navigation
  // ---------------------------------------------------------------------------

  closeTab(id: string): void {
    this._removeTab(id);
  }

  closeActiveTab(): void {
    if (!this.activeTabId) return;
    this.requestCloseTab(this.activeTabId);
  }

  setActiveTab(id: string): void {
    this.activeTabId = id;
    const entry = this.entries.get(id);
    if (entry && this.isVisible && tabProviderRegistry.has(entry.kind)) {
      tabProviderRegistry.get(entry.kind).onActivate?.(entry, this._ctx);
    }
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    reorderTabIds(this, fromIndex, toIndex);
  }

  setNextTabActive(): void {
    tabUtilsSetNextTabActive(this);
  }

  setPreviousTabActive(): void {
    tabUtilsSetPreviousTabActive(this);
  }

  setTabActiveIndex(index: number): void {
    tabUtilsSetTabActiveIndex(this, index);
  }

  // ---------------------------------------------------------------------------
  // TabHost interface — generic primitives used by TabProvider methods
  // ---------------------------------------------------------------------------

  /** Sets isPreview = false (TabHost.pin). */
  pin(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (entry) entry.isPreview = false;
  }

  /** Appends an entry and optionally activates it (TabHost.attachEntry). */
  attachEntry(
    entry: { readonly kind: string; readonly tabId: string; isPreview: boolean },
    opts?: { activate?: boolean }
  ): void {
    this.entries.set(entry.tabId, entry as TabEntryBase);
    addTabId(this, entry.tabId);
    if (opts?.activate) this.activeTabId = entry.tabId;
  }

  /**
   * Returns the first tab-order entry satisfying the type predicate (TabHost.findEntry).
   * Used by TabProvider.open() for deduplication.
   */
  findEntry<E extends object>(predicate: (e: object) => e is E): E | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry && predicate(entry)) return entry as E;
    }
    return undefined;
  }

  /** Closes every tab except the given one (TabHost.closeOthers). */
  closeOthers(tabId: string): void {
    const toClose = this.tabOrder.filter((id) => id !== tabId);
    for (const id of toClose) this.closeTab(id);
  }

  /** User-initiated close — calls def.confirmClose if defined, then closes on confirm. */
  requestCloseTab(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (!entry) return;

    if (tabProviderRegistry.has(entry.kind)) {
      const def = tabProviderRegistry.get(entry.kind);
      if (def.confirmClose) {
        void Promise.resolve(def.confirmClose(entry, this, this._ctx)).then((proceed) => {
          if (proceed) this._removeTab(tabId);
        });
        return;
      }
    }

    this._removeTab(tabId);
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      const entry = this.activeEntry;
      if (entry && tabProviderRegistry.has(entry.kind)) {
        tabProviderRegistry.get(entry.kind).onActivate?.(entry, this._ctx);
      }
    }
  }

  setFocused(focused: boolean): void {
    this.isFocused = focused;
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  restoreSnapshot(snapshot: Partial<TabManagerSnapshot>): void {
    if (snapshot.tabs) {
      // Run onClose for all current entries so kinds can clean up (e.g. browser sessions).
      for (const id of [...this.tabOrder]) {
        const entry = this.entries.get(id);
        if (entry && tabProviderRegistry.has(entry.kind)) {
          tabProviderRegistry.get(entry.kind).onClose?.(entry, this._ctx);
        }
      }
      this.entries.clear();
      this.tabOrder = [];
      for (const desc of snapshot.tabs) {
        if (!tabProviderRegistry.has(desc.kind)) continue;
        const def = tabProviderRegistry.get(desc.kind);
        const entry = def.deserialize(desc, this._ctx) as TabEntryBase;
        this.entries.set(entry.tabId, entry);
        this.tabOrder.push(entry.tabId);
      }
    }
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  dispose(): void {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry && tabProviderRegistry.has(entry.kind)) {
        tabProviderRegistry.get(entry.kind).onClose?.(entry, this._ctx);
      }
    }
    for (const d of this.disposers) d();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _removeTab(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    // Record tab position before removing so we can restore it on reopen.
    const index = this.tabOrder.indexOf(id);
    if (tabProviderRegistry.has(entry.kind)) {
      const data = tabProviderRegistry.get(entry.kind).serialize(entry);
      if (data !== null) {
        this._closedTabHistory.push({ data: data as unknown as TabDescriptor, index });
        if (this._closedTabHistory.length > PaneStore._MAX_CLOSED_HISTORY) {
          this._closedTabHistory.shift();
        }
      }
    }

    this.entries.delete(id);
    removeTabId(this, id);
    if (tabProviderRegistry.has(entry.kind)) {
      tabProviderRegistry.get(entry.kind).onClose?.(entry, this._ctx);
    }
  }

  /**
   * Reopens the most recently closed tab, inserting it at its original position
   * (or at the end when the original index is out of range). No-op if history
   * is empty or the provider cannot deserialize the saved data.
   */
  reopenClosedTab(): void {
    const record = this._closedTabHistory.pop();
    if (!record) return;
    const { data, index } = record;
    if (!tabProviderRegistry.has(data.kind)) return;
    const provider = tabProviderRegistry.get(data.kind);
    const entry = provider.deserialize(data as never, this._ctx) as TabEntryBase;
    this.entries.set(entry.tabId, entry);
    const insertAt = Math.min(index, this.tabOrder.length);
    this.tabOrder.splice(insertAt, 0, entry.tabId);
    this.activeTabId = entry.tabId;
  }

  detachTab(id: string): TabEntryBase | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    this.entries.delete(id);
    removeTabId(this, id);
    return entry;
  }
}

import { action, computed, makeObservable, observable, runInAction } from 'mobx';
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
import type {
  TabEntry,
  TabHandle,
  TabHost,
  TabResource,
  TabViewContext,
  ResolvedTab,
} from './core/tab-provider';
import type { KindOf, OpenArgsOf, TabRegistry } from './core/tab-provider-registry';

class TabEntryImpl<P = unknown> implements TabEntry<P> {
  readonly kind: string;
  readonly tabId: string;
  isPreview: boolean;
  readonly resourceKey: string;
  readonly payload: P;
  /** Engine-level custom title override (from handle.setTitle). */
  customTitle: string | null = null;

  constructor(kind: string, tabId: string, isPreview: boolean, resourceKey: string, payload: P) {
    this.kind = kind;
    this.tabId = tabId;
    this.isPreview = isPreview;
    this.resourceKey = resourceKey;
    this.payload = payload;
    makeObservable(this, {
      isPreview: observable,
      customTitle: observable,
    });
  }
}

/**
 * Owns all tab open/close/order/active state for a single pane.
 *
 * The engine guarantees:
 *   - initialize() is called exactly once when a tab enters the view
 *   - dispose() is called exactly once when a tab permanently leaves the view
 *   - Neither is called during a cross-pane tab move (detachTab + adoptEntry)
 *
 * Domain resource managers (not the engine) are responsible for ref-counting.
 */
export class PaneStore<R extends TabRegistry = TabRegistry>
  implements Snapshottable<TabManagerSnapshot>, TabHost
{
  /** All open tab entries keyed by tabId. O(1) lookup; finer-grained MobX reactivity. */
  readonly entries = observable.map<string, TabEntryImpl>();
  /** Domain resources keyed by tabId. Parallel to entries. */
  readonly _resources = observable.map<string, TabResource>();
  /** Tab display order (array of tabIds). Drives resolvedTabs. */
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;
  isVisible = false;
  /** True when this pane is the active/focused pane AND the task is the active view. */
  isFocused = false;
  /** Current pixel dimensions of the pane container, null until first measurement. */
  dimensions: { width: number; height: number } | null = null;

  readonly registry: R;
  private readonly _ctx: TabViewContext;
  private readonly _closedTabHistory: Array<{
    desc: TabDescriptor;
    index: number;
  }> = [];
  private static readonly _MAX_CLOSED_HISTORY = 20;
  renameRequest: { tabId: string; nonce: number } | null = null;
  private _contentFocuser: (() => void) | null = null;

  get ctx(): TabViewContext {
    return this._ctx;
  }

  constructor(registry: R, ctx: TabViewContext) {
    this.registry = registry;
    this._ctx = ctx;

    makeObservable(this, {
      tabOrder: observable,
      activeTabId: observable,
      isVisible: observable,
      isFocused: observable,
      dimensions: observable,
      resolvedActiveTabId: computed,
      activeEntry: computed,
      resolvedTabs: computed,
      snapshot: computed,
      open: action,
      openKind: action,
      closeTab: action,
      closeActiveTab: action,
      setActiveTab: action,
      reorderTabs: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      setVisible: action,
      setFocused: action,
      setDimensions: action,
      pin: action,
      attachEntry: action,
      closeOthers: action,
      requestCloseTab: action,
      reopenClosedTab: action,
      restoreSnapshot: action,
      detachTab: action,
      adoptEntry: action,
      retargetEntry: action,
      renameRequest: observable,
      requestRename: action,
      clearRenameRequest: action,
      commitRename: action,
    });
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  get resolvedActiveTabId(): string | undefined {
    if (this.activeTabId && this.entries.has(this.activeTabId)) {
      return this.activeTabId;
    }
    return this.tabOrder[0];
  }

  get activeEntry(): TabEntry | undefined {
    return this.entries.get(this.resolvedActiveTabId ?? '');
  }

  /** All entries of the given kind, in tab-order. */
  entriesOfKind<E extends TabEntry>(kind: string): E[] {
    const result: E[] = [];
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === kind) result.push(entry as unknown as E);
    }
    return result;
  }

  activeEntryOfKind<E extends TabEntry>(kind: string): E | undefined {
    const entry = this.activeEntry;
    return entry?.kind === kind ? (entry as unknown as E) : undefined;
  }

  /** All resources of the given kind, in tab-order. */
  resourcesOfKind<T extends TabResource>(kind: string): T[] {
    const result: T[] = [];
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind !== kind) continue;
      const resource = this._resources.get(id);
      if (resource) result.push(resource as T);
    }
    return result;
  }

  /** Resource of the currently active tab if it matches the given kind. */
  activeResourceOfKind<T extends TabResource>(kind: string): T | undefined {
    const activeId = this.resolvedActiveTabId;
    if (!activeId) return undefined;
    const entry = this.entries.get(activeId);
    if (entry?.kind !== kind) return undefined;
    return this._resources.get(activeId) as T | undefined;
  }

  /** Find entry by kind + resourceKey within this pane (used for single-mount checks). */
  entryByKey(kind: string, resourceKey: string): TabEntryImpl | undefined {
    for (const id of this.tabOrder) {
      const e = this.entries.get(id);
      if (e?.kind === kind && e.resourceKey === resourceKey) return e;
    }
    return undefined;
  }

  /** Find the first preview entry of a given kind (used for preview retargeting). */
  private _previewEntryOfKind(kind: string): TabEntryImpl | undefined {
    for (const id of this.tabOrder) {
      const e = this.entries.get(id);
      if (e?.kind === kind && e.isPreview) return e;
    }
    return undefined;
  }

  get resolvedTabs(): ResolvedTab[] {
    const result: ResolvedTab[] = [];
    const effectiveActiveId = this.resolvedActiveTabId;
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (!entry || !this.registry.has(entry.kind)) continue;
      const resource = this._resources.get(id);
      if (!resource) continue;
      const isActive = effectiveActiveId === id;
      result.push({
        kind: entry.kind,
        tabId: id,
        isPreview: entry.isPreview,
        isActive,
        resource,
      } as ResolvedTab);
    }
    return result;
  }

  get snapshot(): TabManagerSnapshot {
    const tabs: TabDescriptor[] = [];
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (!entry || !this.registry.has(entry.kind)) continue;
      const def = this.registry.get(entry.kind);
      const resource = this._resources.get(id);
      const serializablePayload =
        resource && def.getSerializablePayload
          ? def.getSerializablePayload(entry, resource)
          : entry.payload;
      tabs.push({
        kind: entry.kind,
        tabId: entry.tabId,
        isPreview: entry.isPreview,
        ...(serializablePayload as object),
      } as TabDescriptor);
    }
    return { tabs, activeTabId: this.activeTabId };
  }

  // ---------------------------------------------------------------------------
  // Actions — open
  // ---------------------------------------------------------------------------

  /**
   * Generic open: strips the `preview` control flag, runs onBeforeOpen to
   * compute the payload, then deduplicates or creates a new entry.
   */
  open<K extends KindOf<R>>(kind: K, args: OpenArgsOf<R, K>): void {
    if (!this.registry.has(kind as string)) {
      console.warn(`[PaneStore] Unknown tab kind: ${kind as string}`);
      return;
    }
    const def = this.registry.get(kind as string);
    const { preview = false, ...rest } = args as Record<string, unknown>;

    // Compute payload via onBeforeOpen (side-effects allowed) or fall back to args.
    const payload: unknown = def.onBeforeOpen
      ? def.onBeforeOpen(args as never, this._ctx)
      : (rest as unknown);
    if (payload === null) return; // onBeforeOpen aborted the open

    const resourceKey = def.resourceKey(payload as never);

    // Dedup within this pane: exact same key already open.
    const existing = this.entryByKey(kind as string, resourceKey);
    if (existing) {
      if (!preview) existing.isPreview = false; // stable open promotes preview
      const resource = this._resources.get(existing.tabId);
      if (resource && def.onRetarget) {
        def.onRetarget(
          existing as never,
          resource as never,
          payload as never,
          this._buildHandle(existing),
          this._ctx
        );
      }
      this.setActiveTab(existing.tabId);
      return;
    }

    // Preview retarget: replace the existing preview for this kind, if any.
    if (preview) {
      const previewEntry = this._previewEntryOfKind(kind as string);
      if (previewEntry) {
        this.retargetEntry(previewEntry.tabId, {
          resourceKey,
          payload,
          isPreview: true,
        });
        this.setActiveTab(previewEntry.tabId);
        return;
      }
    }

    // Fresh tab.
    const tabId = crypto.randomUUID();
    const entry = new TabEntryImpl(kind as string, tabId, !!preview, resourceKey, payload);
    this._attachEntryAndInitialize(entry, { activate: true });
  }

  openKind(kind: string, args: unknown): void {
    this.open(kind as KindOf<R>, args as OpenArgsOf<R, KindOf<R>>);
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
    const resource = this._resources.get(id);
    if (resource && this.isVisible) {
      resource.onActivate?.();
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
  // TabHost interface
  // ---------------------------------------------------------------------------

  pin(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (entry) entry.isPreview = false;
  }

  /**
   * Appends an entry, initializes it, and optionally activates it.
   * Used by the engine only; NOT exposed on TabHost.
   */
  attachEntry(
    entry: { readonly kind: string; readonly tabId: string; isPreview: boolean },
    opts?: { activate?: boolean }
  ): void {
    // Legacy path: convert a bare entry object to a TabEntryImpl and initialize.
    // Called by older code paths; prefer _attachEntryAndInitialize.
    const impl =
      entry instanceof TabEntryImpl
        ? entry
        : new TabEntryImpl(
            entry.kind,
            entry.tabId,
            entry.isPreview,
            '', // resourceKey unknown without payload — legacy callers should use open()
            {}
          );
    this._attachEntryAndInitialize(impl, opts);
  }

  closeOthers(tabId: string): void {
    const toClose = this.tabOrder.filter((id) => id !== tabId);
    for (const id of toClose) this.closeTab(id);
  }

  requestRename(tabId: string): void {
    this.renameRequest = { tabId, nonce: (this.renameRequest?.nonce ?? 0) + 1 };
  }

  clearRenameRequest(): void {
    this.renameRequest = null;
  }

  commitRename(tabId: string, name: string): void {
    const entry = this.entries.get(tabId);
    if (!entry || !this.registry.has(entry.kind)) return;
    const def = this.registry.get(entry.kind);
    const resource = this._resources.get(tabId);
    if (!resource || !def.commands?.rename) return;
    def.commands.rename.exec(resource, name);
  }

  /**
   * Signals inline rename of the active tab when its kind supports it.
   * Returns true when a renamable tab was signalled, false otherwise.
   */
  renameActiveTab(): boolean {
    const id = this.resolvedActiveTabId;
    if (!id) return false;
    const entry = this.entries.get(id);
    if (!entry || !this.registry.has(entry.kind)) return false;
    if (!this.registry.get(entry.kind).commands?.rename) return false;
    this.requestRename(id);
    return true;
  }

  setContentFocuser(focuser: (() => void) | null): void {
    this._contentFocuser = focuser;
  }

  focusActiveContent(): void {
    const focuser = this._contentFocuser;
    if (!focuser) return;
    requestAnimationFrame(() => focuser());
  }

  /** User-initiated close — calls onBeforeClose if defined, then closes on confirm. */
  requestCloseTab(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (!entry) return;
    const resource = this._resources.get(tabId);

    if (resource && this.registry.has(entry.kind)) {
      const def = this.registry.get(entry.kind);
      if (def.onBeforeClose) {
        void Promise.resolve(def.onBeforeClose(entry as never, resource as never, this._ctx)).then(
          (proceed) => {
            if (proceed) runInAction(() => this._removeTab(tabId));
          }
        );
        return;
      }
    }

    this._removeTab(tabId);
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      const activeId = this.resolvedActiveTabId;
      const resource = activeId ? this._resources.get(activeId) : undefined;
      resource?.onActivate?.();
    }
  }

  setFocused(focused: boolean): void {
    this.isFocused = focused;
  }

  setDimensions(width: number, height: number): void {
    this.dimensions = { width, height };
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  restoreSnapshot(snapshot: Partial<TabManagerSnapshot>): void {
    if (snapshot.tabs) {
      // Dispose all current entries.
      for (const id of [...this.tabOrder]) {
        this._disposeEntry(id);
      }
      this.entries.clear();
      this._resources.clear();
      this.tabOrder = [];

      // Re-initialize from snapshot.
      for (const desc of snapshot.tabs) {
        if (!this.registry.has(desc.kind)) continue;
        const def = this.registry.get(desc.kind);
        const { kind, tabId, isPreview, ...rest } = desc as Record<string, unknown>;
        const payload = rest as unknown;
        const resourceKey = def.resourceKey(payload as never);
        const entry = new TabEntryImpl(
          kind as string,
          tabId as string,
          isPreview as boolean,
          resourceKey,
          payload
        );
        this._attachEntryAndInitialize(entry, { activate: false });
      }
    }
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  dispose(): void {
    for (const id of [...this.tabOrder]) {
      this._disposeEntry(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-pane move support
  // ---------------------------------------------------------------------------

  /**
   * Detaches an entry and its resource from this pane WITHOUT calling dispose.
   * Used by moveTab — the resource survives unchanged.
   * Returns { entry, resource } or undefined if not found.
   */
  detachTab(id: string): { entry: TabEntryImpl; resource: TabResource } | undefined {
    const entry = this.entries.get(id);
    const resource = this._resources.get(id);
    if (!entry || !resource) return undefined;

    this.entries.delete(id);
    this._resources.delete(id);
    removeTabId(this, id);
    return { entry, resource };
  }

  /**
   * Adopts a detached entry+resource from another pane WITHOUT calling initialize.
   * Used by moveTab — the resource continues with no lifecycle transition.
   */
  adoptEntry(
    entry: TabEntryImpl,
    resource: TabResource,
    opts?: { insertBeforeTabId?: string; activate?: boolean }
  ): void {
    this.entries.set(entry.tabId, entry);
    this._resources.set(entry.tabId, resource);
    const insertIdx = opts?.insertBeforeTabId ? this.tabOrder.indexOf(opts.insertBeforeTabId) : -1;
    if (insertIdx === -1) {
      this.tabOrder.push(entry.tabId);
    } else {
      this.tabOrder.splice(insertIdx, 0, entry.tabId);
    }
    if (opts?.activate ?? false) this.activeTabId = entry.tabId;
  }

  /**
   * Replaces an existing entry's payload/resourceKey in-place without changing tabId.
   * Used by the generic open for preview retargeting:
   *   1. Dispose the old resource.
   *   2. Create a new entry with the new payload at the same tabId slot.
   *   3. Initialize the new resource.
   */
  retargetEntry(
    tabId: string,
    update: { resourceKey: string; payload: unknown; isPreview?: boolean }
  ): void {
    const oldEntry = this.entries.get(tabId);
    if (!oldEntry) return;

    // Dispose old resource.
    this._disposeEntry(tabId);
    this._resources.delete(tabId);

    // Create new entry at same slot.
    const newEntry = new TabEntryImpl(
      oldEntry.kind,
      tabId,
      update.isPreview ?? oldEntry.isPreview,
      update.resourceKey,
      update.payload
    );
    this.entries.set(tabId, newEntry);

    // Initialize new resource.
    if (this.registry.has(newEntry.kind)) {
      const def = this.registry.get(newEntry.kind);
      const resource = def.initialize(newEntry as never, this._buildHandle(newEntry), this._ctx);
      this._resources.set(tabId, resource);
    }
  }

  // ---------------------------------------------------------------------------
  // Reopen closed tab
  // ---------------------------------------------------------------------------

  reopenClosedTab(): void {
    const record = this._closedTabHistory.pop();
    if (!record) return;
    const { desc, index } = record;
    if (!this.registry.has(desc.kind)) return;
    const def = this.registry.get(desc.kind);
    const { kind, tabId, isPreview, ...rest } = desc as Record<string, unknown>;
    const payload = rest as unknown;
    const resourceKey = def.resourceKey(payload as never);
    const entry = new TabEntryImpl(
      kind as string,
      tabId as string,
      isPreview as boolean,
      resourceKey,
      payload
    );
    const resource = def.initialize(entry as never, this._buildHandle(entry), this._ctx);
    this.entries.set(entry.tabId, entry);
    this._resources.set(entry.tabId, resource);
    const insertAt = Math.min(index, this.tabOrder.length);
    this.tabOrder.splice(insertAt, 0, entry.tabId);
    this.activeTabId = entry.tabId;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _attachEntryAndInitialize(entry: TabEntryImpl, opts?: { activate?: boolean }): void {
    if (!this.registry.has(entry.kind)) {
      console.warn(`[PaneStore] No provider for kind: ${entry.kind}`);
      return;
    }
    const def = this.registry.get(entry.kind);
    const resource = def.initialize(entry as never, this._buildHandle(entry), this._ctx);
    this.entries.set(entry.tabId, entry);
    this._resources.set(entry.tabId, resource);
    addTabId(this, entry.tabId);
    if (opts?.activate) this.activeTabId = entry.tabId;
  }

  private _removeTab(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    // Record for reopen history before removing.
    const index = this.tabOrder.indexOf(id);
    if (this.registry.has(entry.kind)) {
      const def = this.registry.get(entry.kind);
      const resource = this._resources.get(id);
      const serializablePayload =
        resource && def.getSerializablePayload
          ? def.getSerializablePayload(entry as never, resource as never)
          : entry.payload;
      const desc = {
        kind: entry.kind,
        tabId: entry.tabId,
        isPreview: entry.isPreview,
        ...(serializablePayload as object),
      } as TabDescriptor;
      this._closedTabHistory.push({ desc, index });
      if (this._closedTabHistory.length > PaneStore._MAX_CLOSED_HISTORY) {
        this._closedTabHistory.shift();
      }
    }

    this._disposeEntry(id);
    this.entries.delete(id);
    this._resources.delete(id);
    removeTabId(this, id);
  }

  /** Call provider.dispose() for an entry if its resource exists. Does NOT remove from maps. */
  private _disposeEntry(id: string): void {
    const entry = this.entries.get(id);
    const resource = this._resources.get(id);
    if (!entry || !resource) return;
    if (this.registry.has(entry.kind)) {
      this.registry.get(entry.kind).dispose(entry as never, resource as never, this._ctx);
    }
    resource.dispose();
  }

  /** Builds the TabHandle interface for an entry. */
  private _buildHandle(entry: TabEntryImpl): TabHandle {
    return {
      tabId: entry.tabId,
      pin: action(() => {
        entry.isPreview = false;
      }),
      close: action(() => {
        this._removeTab(entry.tabId);
      }),
      requestClose: action(() => {
        this.requestCloseTab(entry.tabId);
      }),
      setTitle: action((title: string) => {
        entry.customTitle = title;
      }),
      openSibling: (kind: string, args: unknown) => {
        this.openKind(kind, args);
      },
    };
  }
}

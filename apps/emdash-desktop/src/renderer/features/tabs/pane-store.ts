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

// ── Internal plain-data entry with observable isPreview + state ───────────────

class TabEntryImpl<S = unknown> implements TabEntry<S> {
  readonly kind: string;
  readonly tabId: string;
  isPreview: boolean;
  /** Reactive, serializable domain state. Mutated in-place; read by snapshot. */
  state: S;

  constructor(kind: string, tabId: string, isPreview: boolean, state: S) {
    this.kind = kind;
    this.tabId = tabId;
    this.isPreview = isPreview;
    this.state = state;
    makeObservable(this, {
      isPreview: observable,
      state: observable,
    });
  }
}

// ── PaneStore ─────────────────────────────────────────────────────────────────

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
  /**
   * Layout-level opener injected at construction time.
   * Handles target routing and single-mount cardinality checks.
   */
  private readonly _layoutOpener: ((args: Record<string, unknown>) => void) | null;
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

  constructor(
    registry: R,
    ctx: TabViewContext,
    opts?: { layoutOpener?: (args: Record<string, unknown>) => void }
  ) {
    this.registry = registry;
    this._ctx = ctx;
    this._layoutOpener = opts?.layoutOpener ?? null;

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

  /**
   * Find an existing tab entry in this pane using a kind + dedupKey pair.
   * Only meaningful for single-mount providers; returns undefined for multi providers
   * or when no entry with the given computed key exists.
   */
  findSingleMountEntry(kind: string, dedupKey: string): TabEntryImpl | undefined {
    if (!this.registry.has(kind)) return undefined;
    const def = this.registry.get(kind);
    if (!def.mount || def.mount.type !== 'single') return undefined;
    for (const id of this.tabOrder) {
      const e = this.entries.get(id);
      if (e?.kind === kind && def.mount.dedupKey(e.state as never) === dedupKey) return e;
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
      tabs.push({
        kind: entry.kind,
        tabId: entry.tabId,
        isPreview: entry.isPreview,
        ...(entry.state as object),
      } as TabDescriptor);
    }
    return { tabs, activeTabId: this.activeTabId };
  }

  // ---------------------------------------------------------------------------
  // Actions — open (internal; public entry-point is PaneLayoutStore.open)
  // ---------------------------------------------------------------------------

  /**
   * Open a tab in THIS pane. Skips single-mount cardinality (that is enforced by
   * the layout store before routing here). Handles preview retarget within the pane.
   *
   * `initialState` is the already-computed state from the layout store.
   * `isPreview` comes from the caller's `preview` flag.
   * `overrideState` applies when the layout found a single-mount match in this pane.
   */
  openWithState(
    kind: string,
    initialState: unknown,
    opts?: { isPreview?: boolean; overrideState?: boolean }
  ): void {
    const isPreview = opts?.isPreview ?? false;

    if (!this.registry.has(kind)) {
      console.warn(`[PaneStore] Unknown tab kind: ${kind}`);
      return;
    }
    const def = this.registry.get(kind);

    // Single-mount dedup: if already open in THIS pane, focus (and optionally update state).
    if (def.mount?.type === 'single') {
      const dedupKey = def.mount.dedupKey(initialState as never);
      const existing = this.findSingleMountEntry(kind, dedupKey);
      if (existing) {
        if (!isPreview) existing.isPreview = false;
        if (opts?.overrideState) existing.state = initialState;
        this.setActiveTab(existing.tabId);
        return;
      }
    }

    // Preview retarget: replace the existing preview for this kind, if any.
    if (isPreview) {
      const previewEntry = this._previewEntryOfKind(kind);
      if (previewEntry) {
        this.retargetEntry(previewEntry.tabId, { state: initialState, isPreview: true });
        this.setActiveTab(previewEntry.tabId);
        return;
      }
    }

    // Fresh tab.
    const tabId = crypto.randomUUID();
    const entry = new TabEntryImpl(kind, tabId, isPreview, initialState);
    this._attachEntryAndInitialize(entry, { activate: true });
  }

  /**
   * Untyped open used by resources (via handle.open) and legacy callers.
   * Strips control flags and delegates to the layout opener if available,
   * falling back to openWithState in this pane.
   */
  openKind(kind: string, args: unknown): void {
    if (this._layoutOpener) {
      this._layoutOpener({ ...(args as Record<string, unknown>), kind });
    } else {
      // Fallback: compute state and open directly in this pane.
      const argsRec = args as Record<string, unknown>;
      const { preview, overrideState, target: _target, ...rest } = argsRec;
      if (!this.registry.has(kind)) return;
      const def = this.registry.get(kind);
      const state: unknown = def.onBeforeOpen
        ? def.onBeforeOpen(argsRec as never, this._ctx)
        : (rest as unknown);
      if (state === null) return;
      this.openWithState(kind, state, {
        isPreview: !!preview,
        overrideState: !!overrideState,
      });
    }
  }

  /**
   * Typed open for direct PaneStore consumers (e.g. PaneLayoutStore routing into a pane).
   */
  open<K extends KindOf<R>>(kind: K, args: OpenArgsOf<R, K>): void {
    this.openKind(kind as string, args);
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

  /** Fire resource.onActivateIntent() for a tab (called on hover/focus intent). */
  signalActivateIntent(tabId: string): void {
    const resource = this._resources.get(tabId);
    resource?.onActivateIntent?.();
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
        const { kind, tabId, isPreview, ...rest } = desc as Record<string, unknown>;
        const state = rest as unknown;
        const entry = new TabEntryImpl(
          kind as string,
          tabId as string,
          isPreview as boolean,
          state
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
   * Replaces an existing entry's state in-place without changing tabId.
   * Used by the generic open for preview retargeting:
   *   1. Dispose the old resource.
   *   2. Create a new entry with the new state at the same tabId slot.
   *   3. Initialize the new resource.
   */
  retargetEntry(tabId: string, update: { state: unknown; isPreview?: boolean }): void {
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
      update.state
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
    const { kind, tabId, isPreview, ...rest } = desc as Record<string, unknown>;
    const state = rest as unknown;
    const entry = new TabEntryImpl(kind as string, tabId as string, isPreview as boolean, state);
    const def = this.registry.get(kind as string);
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
    const desc = {
      kind: entry.kind,
      tabId: entry.tabId,
      isPreview: entry.isPreview,
      ...(entry.state as object),
    } as TabDescriptor;
    this._closedTabHistory.push({ desc, index });
    if (this._closedTabHistory.length > PaneStore._MAX_CLOSED_HISTORY) {
      this._closedTabHistory.shift();
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
      close: (opts?: { force?: boolean }): Promise<boolean> => {
        if (opts?.force) {
          runInAction(() => this._removeTab(entry.tabId));
          return Promise.resolve(true);
        }
        // User-style close: run onBeforeClose veto.
        const entryRef = this.entries.get(entry.tabId);
        if (!entryRef) return Promise.resolve(false);
        const resource = this._resources.get(entry.tabId);
        if (resource && this.registry.has(entryRef.kind)) {
          const def = this.registry.get(entryRef.kind);
          if (def.onBeforeClose) {
            return Promise.resolve(
              def.onBeforeClose(entryRef as never, resource as never, this._ctx)
            ).then((proceed) => {
              if (proceed) runInAction(() => this._removeTab(entry.tabId));
              return proceed;
            });
          }
        }
        runInAction(() => this._removeTab(entry.tabId));
        return Promise.resolve(true);
      },
      open: (args: { kind: string } & Record<string, unknown>) => {
        this.openKind(args.kind, args);
      },
    };
  }
}

import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { PaneStore } from '@renderer/features/tabs/pane-store';
import type { TabGroupsSnapshot } from '@shared/view-state';
import type { OpenTarget, TabViewContext } from './core/tab-provider';
import type {
  AnyTabProvider,
  TabOpenArgs,
  TabOpenOptions,
  TabRegistry,
  TypedTabRegistry,
} from './core/tab-provider-registry';
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
 * - mount:'single' cardinality — at most one tab per dedupKey across ALL panes
 * - Tab move (detachTab + adoptEntry) — resource survives unchanged, no lifecycle calls
 * - target routing — 'active', 'left', 'right', { paneId }
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
   * The single public open entry point.
   *
   * Accepts a discriminated-union open-args object plus engine control flags:
   *   preview      – open as a preview tab (replaced on next preview open)
   *   overrideState – when single-mount hit, replace the existing tab's state
   *   target       – which pane to open into ('active' | 'left' | 'right' | {paneId})
   *
   * For single-mount providers, scans all panes for an existing dedupKey match
   * and focuses it (with optional state override) instead of opening a new tab.
   *
   * For multi providers, routes directly to the target pane.
   */
  open(
    args: (R extends TypedTabRegistry<infer _P>
      ? TabOpenArgs<R>
      : Record<string, unknown> & { kind: string }) &
      TabOpenOptions
  ): void {
    const argsRec = args as unknown as Record<string, unknown> & { kind: string };
    const { kind, preview, overrideState, target, ...rest } = argsRec;
    const previewFlag = !!preview;
    const overrideStateFlag = !!overrideState;
    const resolvedTarget: OpenTarget = (target as OpenTarget) ?? 'active';

    if (!this._registry.has(kind)) {
      console.warn(`[PaneLayoutStore] Unknown tab kind: ${kind}`);
      return;
    }
    const def = this._registry.get(kind) as AnyTabProvider;

    // Compute initial state via onBeforeOpen or fall back to rest of args.
    const initialState: unknown = def.onBeforeOpen
      ? def.onBeforeOpen(args as never, this._ctx)
      : (rest as unknown);
    if (initialState === null) return; // aborted by onBeforeOpen

    // Single-mount: check ALL panes for an existing dedupKey match.
    if (def.mount?.type === 'single') {
      const dedupKey = def.mount.dedupKey(initialState as never);
      for (const g of this.groups) {
        const existing = g.pane.findSingleMountEntry(kind, dedupKey);
        if (existing) {
          this.setActiveGroup(g.paneId);
          if (!previewFlag) existing.isPreview = false;
          if (overrideStateFlag) existing.state = initialState;
          g.pane.setActiveTab(existing.tabId);
          return;
        }
      }
    }

    // Route to the target pane.
    const targetPane = this._resolveTargetPane(resolvedTarget);
    targetPane.openWithState(kind, initialState, {
      isPreview: previewFlag,
      overrideState: overrideStateFlag,
    });
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a target to an existing or newly-split PaneStore.
   * 'active' => focused pane
   * 'right'  => pane immediately after focused (split if needed and below max)
   * 'left'   => pane immediately before focused (split if needed and below max)
   * { paneId } => specific pane (falls back to focused if not found)
   */
  private _resolveTargetPane(target: OpenTarget): PaneStore<R> {
    if (target === 'active') return this.focusedPane;

    if (typeof target === 'object' && 'paneId' in target) {
      return this.groups.find((g) => g.paneId === target.paneId)?.pane ?? this.focusedPane;
    }

    // 'left' or 'right' — find adjacent pane, splitting if needed.
    const focusedIndex = this.groups.findIndex((g) => g.paneId === this.activePaneId);
    const idx = focusedIndex === -1 ? 0 : focusedIndex;
    const adjacentIndex = target === 'right' ? idx + 1 : idx - 1;

    const existing = this.groups[adjacentIndex];
    if (existing) {
      this.activePaneId = existing.paneId;
      return existing.pane;
    }

    // Need to split.
    if (this.groups.length >= MAX_PANE_COUNT) return this.focusedPane;
    const newGroup = this._createPane();
    const insertAt = target === 'right' ? idx + 1 : idx;
    this.groups.splice(insertAt, 0, newGroup);
    this._redistributeSizes();
    this.activePaneId = newGroup.paneId;
    return newGroup.pane;
  }

  private _createPane(): Pane<R> {
    const paneId = crypto.randomUUID();
    const pane = this._createPaneStore(paneId);
    this._registerAutoClose(paneId, pane);
    return { paneId, pane };
  }

  private _createPaneStore(_paneId: string): PaneStore<R> {
    return new PaneStore<R>(this._registry, this._ctx, {
      layoutOpener: (args) => this.open(args as Parameters<typeof this.open>[0]),
    });
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

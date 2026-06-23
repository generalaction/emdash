import type { GitChangeStatus, GitObjectRef } from '@emdash/core/git';
import { action, computed, makeObservable, observable } from 'mobx';
import type {
  ConversationManagerStore,
  ConversationStore,
} from '@renderer/features/tasks/conversations/conversation-manager';
import type { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import type { FileRendererData } from '@renderer/features/tasks/tabs/file-tab-store';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import {
  addTabId,
  removeTabId,
  reorderTabIds,
  setNextTabActive as tabUtilsSetNextTabActive,
  setPreviousTabActive as tabUtilsSetPreviousTabActive,
  setTabActiveIndex as tabUtilsSetTabActiveIndex,
} from '@renderer/lib/stores/tab-utils';
import { setTelemetryConversationScope } from '@renderer/utils/telemetry-scope';
import type { BrowserSessionSnapshot } from '@shared/browser';
import { refsEqual } from '@shared/core/git/utils';
import type { TabDescriptor, TabManagerSnapshot } from '@shared/view-state';
import type { TabHost, TabKindContext } from './core/tab-provider';
import { tabProviderRegistry } from './core/tab-provider-registry';
import type { TabKind, OpenArgsOf } from './providers';

// ---------------------------------------------------------------------------
// Conversation tab entry — thin reference into ConversationManagerStore
// ---------------------------------------------------------------------------

export class ConversationTabEntry {
  readonly kind = 'conversation' as const;
  readonly tabId: string;
  conversationId: string;
  isPreview: boolean;

  constructor(conversationId: string, isPreview: boolean, tabId?: string) {
    this.tabId = tabId ?? crypto.randomUUID();
    this.conversationId = conversationId;
    this.isPreview = isPreview;
    makeObservable(this, {
      conversationId: observable,
      isPreview: observable,
      pin: action,
    });
  }

  pin(): void {
    this.isPreview = false;
  }
}

export class BrowserTabEntry {
  readonly kind = 'browser' as const;
  readonly tabId: string;
  readonly browserId: string;
  isPreview: boolean;

  constructor(browserId: string, isPreview: boolean, tabId?: string) {
    this.tabId = tabId ?? crypto.randomUUID();
    this.browserId = browserId;
    this.isPreview = isPreview;
    makeObservable(this, {
      isPreview: observable,
      pin: action,
    });
  }

  pin(): void {
    this.isPreview = false;
  }
}

export type TabEntry = FileTabStore | DiffTabStore | ConversationTabEntry | BrowserTabEntry;

export function optionalRefsEqual(
  left: GitObjectRef | undefined,
  right: GitObjectRef | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return refsEqual(left, right);
}

// ---------------------------------------------------------------------------
// Resolved tabs — enriched with live store references and derived state
// ---------------------------------------------------------------------------

export type ResolvedConversationTab = {
  kind: 'conversation';
  tabId: string;
  conversationId: string;
  store: ConversationStore;
  isPreview: boolean;
  isActive: boolean;
};

export type ResolvedFileTab = {
  kind: 'file';
  tabId: string;
  path: string;
  isPreview: boolean;
  isDirty: boolean;
  bufferUri: string;
  isActive: boolean;
  isExternal: boolean;
};

export type ResolvedBrowserTab = {
  kind: 'browser';
  tabId: string;
  browserId: string;
  session: BrowserSessionSnapshot;
  isPreview: boolean;
  isActive: boolean;
};

export type ResolvedDiffTab = {
  kind: 'diff';
  tabId: string;
  path: string;
  diffGroup: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  modifiedRef?: GitObjectRef;
  prNumber?: number;
  prBaseOid?: string;
  prHeadOid?: string;
  commitOriginalSha?: string | null;
  commitModifiedSha?: string;
  status?: GitChangeStatus;
  isPreview: boolean;
  isActive: boolean;
};

export type ResolvedTab =
  | ResolvedConversationTab
  | ResolvedFileTab
  | ResolvedBrowserTab
  | ResolvedDiffTab;

// ---------------------------------------------------------------------------
// TabManagerStore
// ---------------------------------------------------------------------------

/**
 * Owns all tab open/close/order/active state across conversation, file, and diff tabs.
 *
 * Entity-specific state lives in FileTabStore / DiffTabStore / ConversationTabEntry.
 * Monaco model registration is handled by FileModelLifecycleStore which watches this store.
 */
export class PaneStore implements Snapshottable<TabManagerSnapshot>, TabHost {
  /** All open tab entries keyed by tabId. O(1) lookup; finer-grained MobX reactivity. */
  readonly entries = observable.map<string, TabEntry>();
  /** Tab display order (array of tabIds). Drives resolvedTabs. */
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;
  isVisible = false;
  /** True when this pane is the active/focused pane AND the task is the active view. */
  isFocused = false;

  /** Used by resolvedTabs and FileModelLifecycleStore to build buffer URIs. */
  readonly modelRootPath: string;

  private readonly _getConversations: () => ConversationManagerStore | null;
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

  constructor(
    getConversations: () => ConversationManagerStore | null,
    workspaceId: string,
    projectId: string,
    taskId: string
  ) {
    this._getConversations = getConversations;
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
      activeDescriptor: computed,
      activeConversation: computed,
      activeConversationId: computed,
      activeFileEntry: computed,
      activeFilePath: computed,
      activeDiffEntry: computed,
      openFilePaths: computed,
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
      updateRenderer: action,
      setImageContent: action,
      setFileTotalSize: action,
      transitionDiffTab: action,
      pinTab: action,
      pin: action,
      attachEntry: action,
      closeOthers: action,
      requestCloseTab: action,
      reopenClosedTab: action,
      restoreSnapshot: action,
      initializeDefault: action,
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

  get activeDescriptor(): TabEntry | undefined {
    if (!this.resolvedActiveTabId) return undefined;
    return this.entries.get(this.resolvedActiveTabId);
  }

  get activeConversation(): ConversationStore | undefined {
    const desc = this.activeDescriptor;
    if (!desc || desc.kind !== 'conversation') return undefined;
    return this._getConversations()?.conversations.get(desc.conversationId);
  }

  get activeConversationId(): string | undefined {
    const desc = this.activeDescriptor;
    return desc?.kind === 'conversation' ? desc.conversationId : undefined;
  }

  get activeFileEntry(): FileTabStore | undefined {
    const desc = this.activeDescriptor;
    return desc?.kind === 'file' ? desc : undefined;
  }

  get activeFilePath(): string | null {
    return this.activeFileEntry?.path ?? null;
  }

  get activeDiffEntry(): DiffTabStore | undefined {
    const desc = this.activeDescriptor;
    return desc?.kind === 'diff' ? desc : undefined;
  }

  /**
   * Paths of all currently open file tabs.
   * Used by FileModelLifecycleStore to drive Monaco model registration/unregistration.
   * Diff tabs are intentionally excluded — their model lifecycle is managed by
   * FileDiffView's own useEffect.
   */
  get openFilePaths(): string[] {
    const paths: string[] = [];
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'file' && !entry.isExternal) paths.push(entry.path);
    }
    return paths;
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
      } as unknown as ResolvedTab);
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
  // Actions — generic open (replaces 8 open* methods)
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
    this.entries.set(newEntry.tabId, newEntry as unknown as TabEntry);
    this.tabOrder.splice(idx, 1, newEntry.tabId);
    if (opts?.activate ?? true) this.activeTabId = newEntry.tabId;
  }

  // ---------------------------------------------------------------------------
  // Actions — renderer/diff state (delegation proxies)
  // ---------------------------------------------------------------------------

  /** Delegation proxy — callers with the path can still call this. */
  updateRenderer(filePath: string, updater: (prev: FileRendererData) => FileRendererData): void {
    const entry = this._findFileEntryByPath(filePath);
    if (entry) entry.updateRenderer(updater);
  }

  /**
   * Called by the model-lifecycle reaction in TaskViewStore after an image is fetched.
   * Delegation proxy — will be removed when FileModelLifecycleStore is extracted.
   */
  setImageContent(path: string, content: string): void {
    const entry = this._findFileEntryByPath(path);
    if (entry) entry.setImageContent(content);
  }

  /**
   * Called by the model-lifecycle reaction in TaskViewStore after a too-large file is detected.
   * Delegation proxy — will be removed when FileModelLifecycleStore is extracted.
   */
  setFileTotalSize(path: string, totalSize: number): void {
    const entry = this._findFileEntryByPath(path);
    if (entry) entry.setTotalSize(totalSize);
  }

  /**
   * Transitions a diff tab between disk/staged groups in-place.
   * Delegation proxy — will be removed when DiffTabLifecycleStore is extracted.
   */
  transitionDiffTab(
    tabId: string,
    newGroup: 'disk' | 'staged',
    newOriginalRef: GitObjectRef,
    status?: GitChangeStatus
  ): void {
    const entry = this.entries.get(tabId);
    if (entry?.kind === 'diff') entry.transition(newGroup, newOriginalRef, status);
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
    const entry = this.activeDescriptor;
    if (entry?.kind === 'conversation' && this.isVisible) {
      setTelemetryConversationScope(entry.conversationId);
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

  pinTab(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (entry) entry.isPreview = false;
  }

  // ---------------------------------------------------------------------------
  // TabHost interface — generic primitives used by TabDefinition methods
  // ---------------------------------------------------------------------------

  /** Sets isPreview = false (TabHost.pin). Delegates to pinTab. */
  pin(tabId: string): void {
    this.pinTab(tabId);
  }

  /**
   * Appends an entry and optionally activates it (TabHost.attachEntry).
   * Replaces the scattered entries.set + addTabId + activeTabId triples in open*
   * methods after Phase 3.
   */
  attachEntry(
    entry: { readonly kind: string; readonly tabId: string; isPreview: boolean },
    opts?: { activate?: boolean }
  ): void {
    this.entries.set(entry.tabId, entry as unknown as TabEntry);
    addTabId(this, entry.tabId);
    if (opts?.activate) this.activeTabId = entry.tabId;
  }

  /**
   * Returns the first tab-order entry satisfying the type predicate (TabHost.findEntry).
   * Used by TabDefinition.open() for deduplication.
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

  /**
   * User-initiated close — calls def.confirmClose if defined, then closes on confirm.
   * Also marks conversation as seen after close for hydration purposes.
   */
  requestCloseTab(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (!entry) return;

    const conversationId = this._getConversationIdForTab(tabId);
    const afterClose = () => {
      if (conversationId && !this.entries.has(tabId)) {
        this._markConversationSeen(conversationId);
      }
    };

    if (tabProviderRegistry.has(entry.kind)) {
      const def = tabProviderRegistry.get(entry.kind);
      if (def.confirmClose) {
        void Promise.resolve(def.confirmClose(entry, this, this._ctx)).then((proceed) => {
          if (proceed) {
            this._removeTab(tabId);
            afterClose();
          }
        });
        return;
      }
    }

    this._removeTab(tabId);
    afterClose();
  }

  // ---------------------------------------------------------------------------
  // Visibility / telemetry
  // ---------------------------------------------------------------------------

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      setTelemetryConversationScope(this.activeConversation?.data.id ?? null);
    }
  }

  setFocused(focused: boolean): void {
    this.isFocused = focused;
  }

  // ---------------------------------------------------------------------------
  // Helpers for sidebar
  // ---------------------------------------------------------------------------

  hasConversationTab(conversationId: string): boolean {
    return this._findConversationEntry(conversationId) !== undefined;
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
        const entry = def.deserialize(desc, this._ctx) as unknown as TabEntry;
        this.entries.set(entry.tabId, entry);
        this.tabOrder.push(entry.tabId);
      }
    }
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  initializeDefault(): void {
    const conversations = this._getConversations();
    if (!conversations) return;
    for (const [id, store] of conversations.conversations) {
      if (store.isInitialConversation) {
        this.open('conversation', { conversationId: id, preview: false });
        return;
      }
    }
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

  private _findConversationEntry(conversationId: string): ConversationTabEntry | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'conversation' && entry.conversationId === conversationId) {
        return entry;
      }
    }
    return undefined;
  }

  private _findFileEntryByPath(path: string): FileTabStore | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'file' && entry.path === path) return entry;
    }
    return undefined;
  }

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
    const entry = provider.deserialize(data as never, this._ctx) as unknown as TabEntry;
    this.entries.set(entry.tabId, entry);
    const insertAt = Math.min(index, this.tabOrder.length);
    this.tabOrder.splice(insertAt, 0, entry.tabId);
    this.activeTabId = entry.tabId;
  }

  detachTab(id: string): TabEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    this.entries.delete(id);
    removeTabId(this, id);
    return entry;
  }

  private _getConversationIdForTab(id: string): string | undefined {
    const entry = this.entries.get(id);
    return entry?.kind === 'conversation' ? entry.conversationId : undefined;
  }

  private _markConversationSeen(conversationId: string): void {
    this._getConversations()?.conversations.get(conversationId)?.markSeen();
  }
}

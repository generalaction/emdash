import { action, autorun, computed, makeObservable, observable, reaction } from 'mobx';
import type {
  ConversationManagerStore,
  ConversationStore,
} from '@renderer/features/tasks/conversations/conversation-manager';
import { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import type { FileRendererData } from '@renderer/features/tasks/types';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
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
import type { GitChangeStatus, GitObjectRef } from '@shared/git';
import type { ActiveFile, TabDescriptor, TabManagerSnapshot } from '@shared/view-state';

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

export type TabEntry = FileTabStore | DiffTabStore | ConversationTabEntry;

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
};

export type ResolvedDiffTab = {
  kind: 'diff';
  tabId: string;
  path: string;
  diffGroup: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  modifiedRef?: GitObjectRef;
  prNumber?: number;
  status?: GitChangeStatus;
  isPreview: boolean;
  isActive: boolean;
};

export type ResolvedTab = ResolvedConversationTab | ResolvedFileTab | ResolvedDiffTab;

// ---------------------------------------------------------------------------
// TabManagerStore
// ---------------------------------------------------------------------------

/**
 * Owns all tab open/close/order/active state across conversation, file, and diff tabs.
 *
 * Entity-specific state lives in FileTabStore / DiffTabStore / ConversationTabEntry.
 * Monaco model registration is handled by FileModelLifecycleStore which watches this store.
 */
export class TabManagerStore implements Snapshottable<TabManagerSnapshot> {
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
  private readonly disposers: (() => void)[] = [];
  private _closeHandler?: (tabId: string) => Promise<void>;

  constructor(getConversations: () => ConversationManagerStore | null, workspaceId: string) {
    this._getConversations = getConversations;
    this.modelRootPath = `workspace:${workspaceId}`;

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
      previewFileEntry: computed,
      previewDiffEntry: computed,
      openFilePaths: computed,
      resolvedTabs: computed,
      snapshot: computed,
      openConversation: action,
      openConversationPreview: action,
      openFile: action,
      openFilePreview: action,
      openDiff: action,
      openDiffPreview: action,
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
      restoreSnapshot: action,
      initializeDefault: action,
    });

    // Auto-close conversation tabs when the conversation is deleted from the manager.
    this.disposers.push(
      reaction(
        () => Array.from(this._getConversations()?.conversations.keys() ?? []),
        action((ids: string[]) => {
          const idSet = new Set(ids);
          const toRemove: string[] = [];
          for (const [tabId, entry] of this.entries) {
            if (entry.kind === 'conversation' && !idSet.has(entry.conversationId)) {
              toRemove.push(tabId);
            }
          }
          for (const tabId of toRemove) {
            this._removeTab(tabId);
          }
        })
      )
    );

    // Mark conversation as seen when it becomes the active tab in the focused pane.
    this.disposers.push(
      autorun(() => {
        const conv = this.activeConversation;
        if (this.isFocused && conv && !conv.seen) {
          conv.markSeen();
        }
      })
    );

    // Update telemetry scope when the active conversation changes in the focused pane.
    this.disposers.push(
      reaction(
        () => this.activeConversation?.data.id ?? null,
        (conversationId) => {
          if (this.isFocused) {
            setTelemetryConversationScope(conversationId);
          }
        }
      )
    );
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

  get previewFileEntry(): FileTabStore | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'file' && entry.isPreview) return entry;
    }
    return undefined;
  }

  get previewDiffEntry(): DiffTabStore | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'diff' && entry.isPreview) return entry;
    }
    return undefined;
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
      if (entry?.kind === 'file') paths.push(entry.path);
    }
    return paths;
  }

  get resolvedTabs(): ResolvedTab[] {
    const result: ResolvedTab[] = [];
    const effectiveActiveId = this.resolvedActiveTabId;
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (!entry) continue;

      if (entry.kind === 'conversation') {
        const store = this._getConversations()?.conversations.get(entry.conversationId);
        if (!store) continue;
        result.push({
          kind: 'conversation',
          tabId: entry.tabId,
          conversationId: entry.conversationId,
          store,
          isPreview: entry.isPreview,
          isActive: effectiveActiveId === entry.tabId,
        });
      } else if (entry.kind === 'diff') {
        result.push({
          kind: 'diff',
          tabId: entry.tabId,
          path: entry.path,
          diffGroup: entry.diffGroup,
          originalRef: entry.originalRef,
          modifiedRef: entry.modifiedRef,
          prNumber: entry.prNumber,
          status: entry.status,
          isPreview: entry.isPreview,
          isActive: effectiveActiveId === entry.tabId,
        });
      } else {
        const bufferUri = buildMonacoModelPath(this.modelRootPath, entry.path);
        result.push({
          kind: 'file',
          tabId: entry.tabId,
          path: entry.path,
          isPreview: entry.isPreview,
          isDirty: modelRegistry.dirtyUris.has(bufferUri),
          bufferUri,
          isActive: effectiveActiveId === entry.tabId,
        });
      }
    }
    return result;
  }

  get snapshot(): TabManagerSnapshot {
    const tabs: TabDescriptor[] = [];
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      if (entry.kind === 'conversation') {
        tabs.push({
          kind: 'conversation',
          tabId: entry.tabId,
          conversationId: entry.conversationId,
          isPreview: entry.isPreview,
        });
      } else if (entry.kind === 'diff') {
        tabs.push({
          kind: 'diff',
          tabId: entry.tabId,
          path: entry.path,
          diffGroup: entry.diffGroup,
          originalRef: entry.originalRef,
          modifiedRef: entry.modifiedRef,
          prNumber: entry.prNumber,
          status: entry.status,
          isPreview: entry.isPreview,
        });
      } else {
        tabs.push({
          kind: 'file',
          tabId: entry.tabId,
          path: entry.path,
          isPreview: entry.isPreview,
        });
      }
    }
    return { tabs, activeTabId: this.activeTabId };
  }

  // ---------------------------------------------------------------------------
  // Actions — opening conversation tabs
  // ---------------------------------------------------------------------------

  openConversation(conversationId: string): void {
    const existing = this._findConversationEntry(conversationId);
    if (existing) {
      existing.isPreview = false;
      this.activeTabId = existing.tabId;
      return;
    }
    const entry = new ConversationTabEntry(conversationId, false);
    this.entries.set(entry.tabId, entry);
    addTabId(this, entry.tabId);
    this.activeTabId = entry.tabId;
  }

  openConversationPreview(conversationId: string): void {
    const existing = this._findConversationEntry(conversationId);
    if (existing) {
      // Already open (stable or preview) — just activate; never demote stable → preview.
      this.activeTabId = existing.tabId;
      return;
    }
    const previewEntry = this._findConversationPreviewEntry();
    if (previewEntry) {
      // Replace in-place: mutate conversationId so the same tabId and slot are reused.
      previewEntry.conversationId = conversationId;
      this.activeTabId = previewEntry.tabId;
      return;
    }
    const entry = new ConversationTabEntry(conversationId, true);
    this.entries.set(entry.tabId, entry);
    addTabId(this, entry.tabId);
    this.activeTabId = entry.tabId;
  }

  // ---------------------------------------------------------------------------
  // Actions — opening file tabs
  // ---------------------------------------------------------------------------

  openFile(path: string): void {
    const existing = this._findFileEntryByPath(path);
    if (existing) {
      existing.isPreview = false;
      this.activeTabId = existing.tabId;
      return;
    }
    const tab = new FileTabStore(path, false);
    this.entries.set(tab.tabId, tab);
    addTabId(this, tab.tabId);
    this.activeTabId = tab.tabId;
  }

  openFilePreview(path: string): void {
    const existing = this._findFileEntryByPath(path);
    if (existing) {
      this.activeTabId = existing.tabId;
      return;
    }

    const prevPreview = this.previewFileEntry;
    const prevUri = prevPreview ? buildMonacoModelPath(this.modelRootPath, prevPreview.path) : null;
    const canReplace = prevPreview && prevUri && !modelRegistry.isDirty(prevUri);

    if (canReplace && prevPreview) {
      // Mutate in place — tabId unchanged, React sees one render with new content.
      prevPreview.resetForPath(path);
      this.activeTabId = prevPreview.tabId;
      return;
    }

    // No clean preview to reuse. Promote any dirty preview to stable, then add new preview.
    if (prevPreview) prevPreview.isPreview = false;

    const tab = new FileTabStore(path, true);
    this.entries.set(tab.tabId, tab);
    addTabId(this, tab.tabId);
    this.activeTabId = tab.tabId;
  }

  // ---------------------------------------------------------------------------
  // Actions — opening diff tabs
  // ---------------------------------------------------------------------------

  openDiff(activeFile: ActiveFile, status?: GitChangeStatus): void {
    const existing = this._findDiffEntryByKey(activeFile.path, activeFile.group);
    if (existing) {
      existing.isPreview = false;
      if (status !== undefined) existing.status = status;
      this.activeTabId = existing.tabId;
      return;
    }
    const tab = new DiffTabStore(activeFile, false, undefined, status);
    this.entries.set(tab.tabId, tab);
    addTabId(this, tab.tabId);
    this.activeTabId = tab.tabId;
  }

  openDiffPreview(activeFile: ActiveFile, status?: GitChangeStatus): void {
    const existing = this._findDiffEntryByKey(activeFile.path, activeFile.group);
    if (existing) {
      this.activeTabId = existing.tabId;
      return;
    }

    const previewEntry = this.previewDiffEntry;
    if (previewEntry) {
      // Replace preview in-place: remove old, insert new at same position.
      const idx = this.tabOrder.indexOf(previewEntry.tabId);
      this.entries.delete(previewEntry.tabId);
      const tab = new DiffTabStore(activeFile, true, undefined, status);
      this.entries.set(tab.tabId, tab);
      this.tabOrder.splice(idx, 1, tab.tabId);
      this.activeTabId = tab.tabId;
      return;
    }

    const tab = new DiffTabStore(activeFile, true, undefined, status);
    this.entries.set(tab.tabId, tab);
    addTabId(this, tab.tabId);
    this.activeTabId = tab.tabId;
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

  /**
   * Registers an async handler that is called for user-initiated tab closes.
   * The handler is responsible for calling closeTab when it is ready to proceed.
   * Force-closes via closeTab bypass this handler entirely.
   */
  registerCloseHandler(handler: (tabId: string) => Promise<void>): void {
    this._closeHandler = handler;
  }

  /**
   * User-initiated close — delegates to the registered close handler if present,
   * falling back to a direct _removeTab. Use this for all UI and keyboard closes.
   * Do NOT use for programmatic/internal closes (use closeTab instead).
   */
  closeTabWithGuard(id: string): void {
    if (this._closeHandler) {
      void this._closeHandler(id);
    } else {
      this._removeTab(id);
    }
  }

  closeActiveTab(): void {
    if (!this.activeTabId) return;
    this.closeTabWithGuard(this.activeTabId);
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
      this.entries.clear();
      this.tabOrder = [];
      for (const t of snapshot.tabs) {
        if (t.kind === 'conversation') {
          const entry = new ConversationTabEntry(t.conversationId, t.isPreview, t.tabId);
          this.entries.set(entry.tabId, entry);
          this.tabOrder.push(entry.tabId);
        } else if (t.kind === 'diff') {
          const tab = new DiffTabStore(
            {
              path: t.path,
              type: t.diffGroup === 'disk' ? 'disk' : 'git',
              group: t.diffGroup,
              originalRef: t.originalRef,
              modifiedRef: t.modifiedRef,
              prNumber: t.prNumber,
            },
            t.isPreview,
            t.tabId,
            t.status
          );
          this.entries.set(tab.tabId, tab);
          this.tabOrder.push(tab.tabId);
        } else {
          const tab = new FileTabStore(t.path, t.isPreview, t.tabId);
          this.entries.set(tab.tabId, tab);
          this.tabOrder.push(tab.tabId);
        }
      }
    }
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  initializeDefault(): void {
    const conversations = this._getConversations();
    if (!conversations) return;
    for (const [id, store] of conversations.conversations) {
      if (store.isInitialConversation) {
        this.openConversation(id);
        return;
      }
    }
  }

  dispose(): void {
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

  private _findConversationPreviewEntry(): ConversationTabEntry | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'conversation' && entry.isPreview) return entry;
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

  private _findDiffEntryByKey(path: string, group: string): DiffTabStore | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'diff' && entry.path === path && entry.diffGroup === group) return entry;
    }
    return undefined;
  }

  private _removeTab(id: string): void {
    if (!this.entries.has(id)) return;
    this.entries.delete(id);
    removeTabId(this, id);
  }
}

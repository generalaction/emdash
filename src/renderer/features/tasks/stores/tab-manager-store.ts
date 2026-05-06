import { action, autorun, computed, makeObservable, observable, reaction } from 'mobx';
import type { TabDescriptor, TabManagerSnapshot } from '@shared/view-state';
import type {
  ConversationManagerStore,
  ConversationStore,
} from '@renderer/features/tasks/conversations/conversation-manager';
import type { FileRendererData } from '@renderer/features/tasks/types';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import { getDefaultRenderer } from '@renderer/lib/editor/renderer-utils';
import type { ManagedFileKind } from '@renderer/lib/editor/types';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import type { TabViewProvider } from '@renderer/lib/stores/generic-tab-view';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import { setTelemetryConversationScope } from '@renderer/utils/telemetry-scope';

// ---------------------------------------------------------------------------
// Runtime tab state types (richer than the persisted TabDescriptor snapshot)
// ---------------------------------------------------------------------------

/**
 * Full runtime state for an open file tab.
 * `fileKind` is the kind of file content (text, image, etc.).
 * `kind: 'file'` is the discriminant for the TabState union.
 */
export type FileTabState = {
  kind: 'file';
  tabId: string;
  path: string;
  isPreview: boolean;
  fileKind: ManagedFileKind;
  renderer: FileRendererData;
  /** Data-URL for image files; empty string for Monaco-backed files. */
  content: string;
  /** True only for image files while the data-URL is being fetched. */
  isLoading: boolean;
  totalSize?: number | null;
};

type ConversationTabState = {
  kind: 'conversation';
  id: string;
  isPreview: boolean;
};

export type TabState = FileTabState | ConversationTabState;

export type ResolvedConversationTab = {
  kind: 'conversation';
  id: string;
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

export type ResolvedTab = ResolvedConversationTab | ResolvedFileTab;

function getTabId(tab: TabState): string {
  return tab.kind === 'conversation' ? tab.id : tab.tabId;
}

/**
 * Thin adapter exposing a TabViewProvider<ConversationStore> interface for
 * TabbedPtyPanel. Computed getters stay reactive because this object is used
 * inside MobX observer components.
 */
export class ConversationTabAdapter implements TabViewProvider<ConversationStore, never> {
  constructor(
    private readonly tabManager: TabManagerStore,
    private readonly conversations: ConversationManagerStore
  ) {}

  get tabs(): ConversationStore[] {
    return this.tabManager.tabs
      .filter((t): t is Extract<TabState, { kind: 'conversation' }> => t.kind === 'conversation')
      .map((t) => this.conversations.conversations.get(t.id))
      .filter(Boolean) as ConversationStore[];
  }

  get activeTab(): ConversationStore | undefined {
    return this.tabManager.activeConversation;
  }

  get activeTabId(): string | undefined {
    const desc = this.tabManager.activeDescriptor;
    return desc?.kind === 'conversation' ? desc.id : undefined;
  }

  setActiveTab(id: string): void {
    this.tabManager.setActiveTab(id);
  }

  removeTab(id: string): void {
    this.tabManager.closeTab(id);
  }

  addTab(_args: never): void { /* not used — conversation tabs are opened via openConversation */ }

  reorderTabs(fromIndex: number, toIndex: number): void {
    this.tabManager.reorderTabs(fromIndex, toIndex);
  }

  setNextTabActive(): void {
    this.tabManager.setNextTabActive();
  }

  setPreviousTabActive(): void {
    this.tabManager.setPreviousTabActive();
  }

  setTabActiveIndex(index: number): void {
    this.tabManager.setTabActiveIndex(index);
  }
}

/**
 * Owns all tab open/close/order/active state across conversation and file tabs.
 *
 * File tab display state (renderer, content, isLoading) lives here as the single
 * source of truth. Monaco model registration is handled reactively in TaskViewStore
 * via the `openFilePaths` computed — no imperative register/unregister calls needed.
 */
export class TabManagerStore implements Snapshottable<TabManagerSnapshot> {
  tabs: TabState[] = [];
  activeTabId: string | undefined = undefined;
  isVisible = false;

  /** Computed once from workspaceId; used by resolvedTabs to build bufferUri. */
  readonly modelRootPath: string;

  readonly conversationAdapter: ConversationTabAdapter;

  private readonly conversations: ConversationManagerStore;
  private readonly disposers: (() => void)[] = [];

  constructor(conversations: ConversationManagerStore, workspaceId: string) {
    this.conversations = conversations;
    this.modelRootPath = `workspace:${workspaceId}`;
    this.conversationAdapter = new ConversationTabAdapter(this, conversations);

    makeObservable(this, {
      tabs: observable,
      activeTabId: observable,
      isVisible: observable,
      activeDescriptor: computed,
      activeConversation: computed,
      activeFileTab: computed,
      activeFilePath: computed,
      previewFileTab: computed,
      openFilePaths: computed,
      resolvedTabs: computed,
      snapshot: computed,
      openConversation: action,
      openConversationPreview: action,
      openFile: action,
      openFilePreview: action,
      closeTab: action,
      closeActiveTab: action,
      setActiveTab: action,
      reorderTabs: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      setVisible: action,
      updateRenderer: action,
      setImageContent: action,
      pinTab: action,
      restoreSnapshot: action,
    });

    // Auto-close conversation tabs when the conversation is deleted from the manager.
    this.disposers.push(
      reaction(
        () => Array.from(conversations.conversations.keys()),
        action((ids: string[]) => {
          const idSet = new Set(ids);
          for (let i = this.tabs.length - 1; i >= 0; i--) {
            const tab = this.tabs[i];
            if (tab.kind === 'conversation' && !idSet.has(tab.id)) {
              this._removeTab(tab.id);
            }
          }
        })
      )
    );

    // Mark conversation as seen when it becomes the active visible tab.
    this.disposers.push(
      autorun(() => {
        if (this.isVisible && this.activeConversation && !this.activeConversation.seen) {
          this.activeConversation.markSeen();
        }
      })
    );

    // Update telemetry scope when the active conversation changes.
    this.disposers.push(
      reaction(
        () => this.activeConversation?.data.id ?? null,
        (conversationId) => {
          if (this.isVisible) {
            setTelemetryConversationScope(conversationId);
          }
        }
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  get activeDescriptor(): TabState | undefined {
    if (!this.activeTabId) return undefined;
    return this.tabs.find(
      (t) =>
        (t.kind === 'conversation' && t.id === this.activeTabId) ||
        (t.kind === 'file' && t.tabId === this.activeTabId)
    );
  }

  get activeConversation(): ConversationStore | undefined {
    const desc = this.activeDescriptor;
    if (!desc || desc.kind !== 'conversation') return undefined;
    return this.conversations.conversations.get(desc.id);
  }

  get activeFileTab(): FileTabState | undefined {
    const desc = this.activeDescriptor;
    return desc?.kind === 'file' ? (desc as FileTabState) : undefined;
  }

  get activeFilePath(): string | null {
    return this.activeFileTab?.path ?? null;
  }

  get previewFileTab(): FileTabState | undefined {
    return this.tabs.find((t): t is FileTabState => t.kind === 'file' && t.isPreview);
  }

  /**
   * The set of currently open file paths. Used by the model-lifecycle reaction
   * in TaskViewStore to drive Monaco model registration/unregistration.
   */
  get openFilePaths(): string[] {
    return this.tabs.filter((t): t is FileTabState => t.kind === 'file').map((t) => t.path);
  }

  get resolvedTabs(): ResolvedTab[] {
    return this.tabs
      .map((tab): ResolvedTab | null => {
        if (tab.kind === 'conversation') {
          const store = this.conversations.conversations.get(tab.id);
          if (!store) return null;
          return {
            kind: 'conversation',
            id: tab.id,
            store,
            isPreview: tab.isPreview,
            isActive: this.activeTabId === tab.id,
          };
        }
        const bufferUri = buildMonacoModelPath(this.modelRootPath, tab.path);
        return {
          kind: 'file',
          tabId: tab.tabId,
          path: tab.path,
          isPreview: tab.isPreview,
          isDirty: modelRegistry.dirtyUris.has(bufferUri),
          bufferUri,
          isActive: this.activeTabId === tab.tabId,
        };
      })
      .filter(Boolean) as ResolvedTab[];
  }

  get snapshot(): TabManagerSnapshot {
    return {
      tabs: this.tabs.map((t): TabDescriptor => {
        if (t.kind === 'conversation') return t;
        return { kind: 'file', tabId: t.tabId, path: t.path, isPreview: t.isPreview };
      }),
      activeTabId: this.activeTabId,
    };
  }

  // ---------------------------------------------------------------------------
  // Actions — opening conversation tabs
  // ---------------------------------------------------------------------------

  openConversation(id: string): void {
    const existing = this.tabs.find(
      (t): t is ConversationTabState => t.kind === 'conversation' && t.id === id
    );
    if (existing) {
      existing.isPreview = false;
    } else {
      this.tabs.push({ kind: 'conversation', id, isPreview: false });
    }
    this.activeTabId = id;
  }

  openConversationPreview(id: string): void {
    const existing = this.tabs.find(
      (t): t is ConversationTabState => t.kind === 'conversation' && t.id === id
    );
    if (existing) {
      // Already open (stable or preview) — just activate; never demote stable → preview.
      this.activeTabId = existing.id;
      return;
    }
    const previewIdx = this.tabs.findIndex(
      (t): t is ConversationTabState => t.kind === 'conversation' && t.isPreview
    );
    if (previewIdx !== -1) {
      this.tabs[previewIdx] = { kind: 'conversation', id, isPreview: true };
    } else {
      this.tabs.push({ kind: 'conversation', id, isPreview: true });
    }
    this.activeTabId = id;
  }

  // ---------------------------------------------------------------------------
  // Actions — opening file tabs
  // ---------------------------------------------------------------------------

  /**
   * Opens a file as a stable tab (double-click / explicit open).
   * If the file is already open as a preview, promotes it to stable.
   * Model registration is handled reactively via openFilePaths in TaskViewStore.
   */
  openFile(path: string): void {
    const existing = this.tabs.find((t): t is FileTabState => t.kind === 'file' && t.path === path);
    if (existing) {
      existing.isPreview = false;
      this.activeTabId = existing.tabId;
      return;
    }
    const tab = this._makeFileTab(path, false);
    this.tabs.push(tab);
    this.activeTabId = tab.tabId;
  }

  /**
   * Opens a file as an unstable preview tab (single-click).
   * If a clean preview tab already exists, mutates it in place so that the
   * same tabId stays in the list — React sees an update, not a remove+add.
   * If the existing preview is dirty, it is promoted to stable and a new preview is added.
   * Model registration is handled reactively via openFilePaths in TaskViewStore.
   */
  openFilePreview(path: string): void {
    // Already open (stable or preview) — just activate.
    const existing = this.tabs.find((t): t is FileTabState => t.kind === 'file' && t.path === path);
    if (existing) {
      this.activeTabId = existing.tabId;
      return;
    }

    const prevPreview = this.previewFileTab;
    const prevUri = prevPreview ? buildMonacoModelPath(this.modelRootPath, prevPreview.path) : null;
    const canReplace = prevPreview && prevUri && !modelRegistry.isDirty(prevUri);

    if (canReplace && prevPreview) {
      // Mutate in place — tabId unchanged, React sees one render with new content.
      const fileKind = getFileKind(path);
      prevPreview.path = path;
      prevPreview.fileKind = fileKind;
      prevPreview.renderer = getDefaultRenderer(fileKind);
      prevPreview.content = '';
      prevPreview.isLoading = fileKind === 'image';
      prevPreview.totalSize = null;
      this.activeTabId = prevPreview.tabId;
      return;
    }

    // No clean preview to reuse. Promote any dirty preview to stable, then add new preview.
    if (prevPreview) prevPreview.isPreview = false;

    const tab = this._makeFileTab(path, true);
    this.tabs.push(tab);
    this.activeTabId = tab.tabId;
  }

  // ---------------------------------------------------------------------------
  // Actions — renderer state
  // ---------------------------------------------------------------------------

  updateRenderer(filePath: string, updater: (prev: FileRendererData) => FileRendererData): void {
    const tab = this.tabs.find((t): t is FileTabState => t.kind === 'file' && t.path === filePath);
    if (tab) tab.renderer = updater(tab.renderer);
  }

  /**
   * Called by the model-lifecycle reaction in TaskViewStore after an image is fetched.
   */
  setImageContent(path: string, content: string): void {
    const tab = this.tabs.find((t): t is FileTabState => t.kind === 'file' && t.path === path);
    if (tab) {
      tab.content = content;
      tab.isLoading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Actions — closing / navigation
  // ---------------------------------------------------------------------------

  closeTab(id: string): void {
    this._removeTab(id);
  }

  closeActiveTab(): void {
    if (!this.activeTabId) return;
    this.closeTab(this.activeTabId);
  }

  setActiveTab(id: string): void {
    this.activeTabId = id;
    if (this.activeDescriptor?.kind === 'conversation' && this.isVisible) {
      setTelemetryConversationScope(this.activeDescriptor.id);
    }
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const [tab] = this.tabs.splice(fromIndex, 1);
    this.tabs.splice(toIndex, 0, tab);
  }

  setNextTabActive(): void {
    if (!this.activeTabId) return;
    const idx = this.tabs.findIndex((t) => getTabId(t) === this.activeTabId);
    const next = this.tabs[idx + 1];
    if (next) this.activeTabId = getTabId(next);
  }

  setPreviousTabActive(): void {
    if (!this.activeTabId) return;
    const idx = this.tabs.findIndex((t) => getTabId(t) === this.activeTabId);
    const prev = this.tabs[idx - 1];
    if (prev) this.activeTabId = getTabId(prev);
  }

  setTabActiveIndex(index: number): void {
    const tab = this.tabs[Math.min(index, this.tabs.length - 1)];
    if (tab) this.activeTabId = getTabId(tab);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  pinTab(tabId: string): void {
    const tab = this.tabs.find((t): t is FileTabState => t.kind === 'file' && t.tabId === tabId);
    if (tab) tab.isPreview = false;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      setTelemetryConversationScope(this.activeConversation?.data.id ?? null);
    }
  }

  restoreSnapshot(snapshot: Partial<TabManagerSnapshot>): void {
    if (snapshot.tabs) {
      this.tabs = snapshot.tabs.map((t): TabState => {
        if (t.kind === 'conversation')
          return { kind: 'conversation', id: t.id, isPreview: t.isPreview };
        return this._makeFileTab(t.path, t.isPreview, t.tabId);
      });
    }
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _makeFileTab(filePath: string, isPreview: boolean, tabId?: string): FileTabState {
    const fileKind = getFileKind(filePath);
    return {
      kind: 'file',
      tabId: tabId ?? crypto.randomUUID(),
      path: filePath,
      isPreview,
      fileKind,
      renderer: getDefaultRenderer(fileKind),
      content: '',
      isLoading: fileKind === 'image',
      totalSize: null,
    };
  }

  private _removeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => getTabId(t) === id);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (this.activeTabId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1];
      this.activeTabId = next ? getTabId(next) : undefined;
    }
  }
}

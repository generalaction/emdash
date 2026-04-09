import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { EditorViewSnapshot } from '@shared/view-state';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';
import { log } from '@renderer/lib/logger';
import { getFileKind } from '../editor/fileKind';
import { getDefaultRenderer } from '../editor/renderer-utils';
import { EditorTab } from '../editor/types';
import { rpc } from '../ipc';
import { modelRegistry } from '../monaco/monaco-model-registry';
import { buildMonacoModelPath } from '../monaco/monacoModelPath';
import { FileRendererData } from '../tasks/types';
import type { Snapshottable } from './snapshottable';

export class EditorViewStore implements Snapshottable<EditorViewSnapshot> {
  readonly modelRootPath: string;

  private readonly _tabs = observable.array<EditorTab>();
  activeTabId: string | null = null;
  isSaving = false;

  /**
   * Set to the buffer URI of a file that has a conflict pending resolution.
   * EditorProvider watches this via a MobX reaction and shows the conflict modal.
   */
  pendingConflictUri: string | null = null;

  /** Persisted navigation state for the file tree sidebar. */
  expandedPaths = observable.set<string>();

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string
  ) {
    this.modelRootPath = `workspace:${workspaceId}`;
    makeAutoObservable(this, { modelRootPath: false });
  }

  get tabs(): Array<EditorTab & { isDirty: boolean; bufferUri: string }> {
    return this._tabs.map((tab) => {
      const bufferUri = buildMonacoModelPath(this.modelRootPath, tab.path);
      return { ...tab, bufferUri, isDirty: modelRegistry.dirtyUris.has(bufferUri) };
    });
  }

  get activeTab(): (EditorTab & { isDirty: boolean; bufferUri: string }) | undefined {
    return this.tabs.find((t) => t.tabId === this.activeTabId);
  }

  get activeFilePath(): string | null {
    return this.activeTab?.path ?? null;
  }

  get previewTab(): (EditorTab & { isDirty: boolean; bufferUri: string }) | undefined {
    return this.tabs.find((t) => t.isPreview);
  }

  // ---------------------------------------------------------------------------
  // Snapshottable
  // ---------------------------------------------------------------------------

  get snapshot(): EditorViewSnapshot {
    return {
      tabs: this._tabs.map((t) => ({ tabId: t.tabId, path: t.path, isPreview: t.isPreview })),
      activeTabId: this.activeTabId,
      expandedPaths: [...this.expandedPaths],
    };
  }

  restoreSnapshot(snapshot: Partial<EditorViewSnapshot>): void {
    if (snapshot.tabs) {
      this._tabs.replace(snapshot.tabs.map((t) => this._makeTab(t.path, t.isPreview, t.tabId)));
    }
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
    if (snapshot.expandedPaths) {
      this.expandedPaths.replace(snapshot.expandedPaths);
    }
  }

  // ---------------------------------------------------------------------------
  // Tab view interface
  // ---------------------------------------------------------------------------

  setActiveTab(tabId: string): void {
    this.activeTabId = tabId;
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const [tab] = this._tabs.splice(fromIndex, 1);
    this._tabs.splice(toIndex, 0, tab);
  }

  setNextTabActive(): void {
    if (!this.activeTabId) return;
    const idx = this._tabs.findIndex((t) => t.tabId === this.activeTabId);
    const next = this._tabs[idx + 1];
    if (next) this.activeTabId = next.tabId;
  }

  setPreviousTabActive(): void {
    if (!this.activeTabId) return;
    const idx = this._tabs.findIndex((t) => t.tabId === this.activeTabId);
    const prev = this._tabs[idx - 1];
    if (prev) this.activeTabId = prev.tabId;
  }

  setTabActiveIndex(index: number): void {
    const tab = this._tabs[index];
    if (tab) this.activeTabId = tab.tabId;
  }

  closeActiveTab(): void {
    if (this.activeTabId) this.removeTab(this.activeTabId);
  }

  // ---------------------------------------------------------------------------
  // File opening
  // ---------------------------------------------------------------------------

  /**
   * Opens a file as a stable tab (double-click / explicit open).
   * If the file is already open as a preview, promotes it to stable.
   */
  openFile(filePath: string): void {
    const existing = this._tabs.find((t) => t.path === filePath);
    if (existing) {
      existing.isPreview = false;
      this.activeTabId = existing.tabId;
      return;
    }
    const tab = this._makeTab(filePath, false);
    this._tabs.push(tab);
    this.activeTabId = tab.tabId;
    void this._registerModels(filePath);
  }

  /**
   * Opens a file as an unstable preview tab (single-click).
   * If a clean preview tab already exists, mutates it in place so that the
   * same tabId stays in the list — React sees an update, not a remove+add, so
   * there is no flash of two tabs.
   */
  openFilePreview(filePath: string): void {
    const existing = this._tabs.find((t) => t.path === filePath);
    if (existing) {
      this.activeTabId = existing.tabId;
      return;
    }

    const prevPreview = this._tabs.find((t) => t.isPreview);
    const prevUri = prevPreview ? buildMonacoModelPath(this.modelRootPath, prevPreview.path) : null;
    const canReplace = prevPreview && prevUri && !modelRegistry.isDirty(prevUri);

    if (canReplace && prevPreview && prevUri) {
      // Unregister the outgoing preview's models before mutating.
      const oldFilePath = prevPreview.path;
      this._unregisterModels(prevUri);
      void rpc.editorBuffer.clearBuffer(this.projectId, this.workspaceId, oldFilePath);

      const kind = getFileKind(filePath);
      // Mutate in place — tabId unchanged, React sees one render with new content.
      prevPreview.path = filePath;
      prevPreview.kind = kind;
      prevPreview.renderer = getDefaultRenderer(kind);
      prevPreview.content = '';
      prevPreview.isLoading = kind === 'image';
      prevPreview.totalSize = null;
      this.activeTabId = prevPreview.tabId;
    } else {
      const tab = this._makeTab(filePath, true);
      this._tabs.push(tab);
      this.activeTabId = tab.tabId;
    }

    void this._registerModels(filePath);
  }

  // ---------------------------------------------------------------------------
  // Tab management
  // ---------------------------------------------------------------------------

  removeTab(tabId: string): void {
    const idx = this._tabs.findIndex((t) => t.tabId === tabId);
    if (idx === -1) return;
    const tab = this._tabs[idx];
    const uri = buildMonacoModelPath(this.modelRootPath, tab.path);
    this._unregisterModels(uri);
    void rpc.editorBuffer.clearBuffer(this.projectId, this.workspaceId, tab.path);
    this._tabs.splice(idx, 1);
    if (this.activeTabId === tabId) {
      this.activeTabId = (this._tabs[idx] ?? this._tabs[idx - 1])?.tabId ?? null;
    }
  }

  pinTab(tabId: string): void {
    const tab = this._tabs.find((t) => t.tabId === tabId);
    if (tab) tab.isPreview = false;
  }

  // ---------------------------------------------------------------------------
  // Renderer
  // ---------------------------------------------------------------------------

  updateRenderer(filePath: string, updater: (prev: FileRendererData) => FileRendererData): void {
    const tab = this._tabs.find((t) => t.path === filePath);
    if (tab) tab.renderer = updater(tab.renderer);
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async saveFile(filePath?: string): Promise<void> {
    const targetPath = filePath ?? this.activeFilePath;
    if (!targetPath) return;
    const uri = buildMonacoModelPath(this.modelRootPath, targetPath);
    if (!modelRegistry.isDirty(uri)) return;

    if (modelRegistry.hasPendingConflict(uri)) {
      runInAction(() => {
        this.pendingConflictUri = uri;
      });
      return;
    }

    runInAction(() => {
      this.isSaving = true;
    });
    try {
      const result = await modelRegistry.saveFileToDisk(uri);
      if (result === null) {
        log.error('[EditorViewStore] Failed to save file:', targetPath);
      }
    } catch (error) {
      log.error('[EditorViewStore] Error saving file:', error);
    } finally {
      runInAction(() => {
        this.isSaving = false;
      });
    }
  }

  async saveAllFiles(): Promise<void> {
    const dirtyPaths = this._tabs
      .filter((t) => modelRegistry.isDirty(buildMonacoModelPath(this.modelRootPath, t.path)))
      .map((t) => t.path);
    for (const path of dirtyPaths) {
      await this.saveFile(path);
    }
  }

  /**
   * Resolves a pending conflict: either reloads buffer from disk ("Accept Incoming")
   * or writes the user's buffer to disk ("Keep Mine").
   * Called from EditorProvider after the conflict dialog resolves.
   */
  async resolveConflict(accept: boolean): Promise<void> {
    const uri = this.pendingConflictUri;
    if (!uri) return;
    const tab = this._tabs.find((t) => buildMonacoModelPath(this.modelRootPath, t.path) === uri);
    runInAction(() => {
      this.pendingConflictUri = null;
    });
    if (!tab) return;

    if (accept) {
      modelRegistry.reloadFromDisk(uri);
      void rpc.editorBuffer.clearBuffer(this.projectId, this.workspaceId, tab.path);
    } else {
      runInAction(() => {
        this.isSaving = true;
      });
      try {
        await modelRegistry.saveFileToDisk(uri);
      } finally {
        runInAction(() => {
          this.isSaving = false;
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Re-registers Monaco models for all currently open tabs and restores any
   * crash-recovery buffer content. Called by EditorProvider on mount so that
   * Monaco models (which are ephemeral) are recreated after a remount.
   */
  async restore(): Promise<void> {
    for (const tab of this._tabs) {
      void this._registerModels(tab.path);
    }
    try {
      const buffers = await rpc.editorBuffer.listBuffers(this.projectId, this.workspaceId);
      for (const { filePath, content } of buffers) {
        const uri = buildMonacoModelPath(this.modelRootPath, filePath);
        const model = modelRegistry.getModelByUri(uri);
        if (model) model.setValue(content);
      }
    } catch (e) {
      log.warn('[EditorViewStore] Failed to restore buffers:', e);
    }
  }

  dispose(): void {
    for (const tab of this._tabs) {
      const uri = buildMonacoModelPath(this.modelRootPath, tab.path);
      this._unregisterModels(uri);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _makeTab(filePath: string, isPreview: boolean, tabId?: string): EditorTab {
    const kind = getFileKind(filePath);
    return {
      tabId: tabId ?? crypto.randomUUID(),
      path: filePath,
      kind,
      renderer: getDefaultRenderer(kind),
      content: '',
      isLoading: kind === 'image',
      isPreview,
    };
  }

  private async _registerModels(filePath: string): Promise<void> {
    const kind = getFileKind(filePath);

    if (kind === 'image') {
      const result = await rpc.fs.readImage(this.projectId, this.workspaceId, filePath);
      runInAction(() => {
        const tab = this._tabs.find((t) => t.path === filePath);
        if (tab) {
          tab.content = result.success ? (result.data?.dataUrl ?? '') : '';
          tab.isLoading = false;
        }
      });
      return;
    }

    if (kind === 'text' || kind === 'markdown' || kind === 'svg') {
      const language = getMonacoLanguageId(filePath);

      // Preserve an existing non-default renderer (e.g. markdown-source) if it
      // matches the file kind. Otherwise reset to the default.
      const existingTab = this._tabs.find((t) => t.path === filePath);
      if (existingTab && !existingTab.renderer.kind.startsWith(kind)) {
        runInAction(() => {
          existingTab.renderer = getDefaultRenderer(kind);
        });
      }

      await modelRegistry.registerModel(
        this.projectId,
        this.workspaceId,
        this.modelRootPath,
        filePath,
        language,
        'disk'
      );
      await modelRegistry.registerModel(
        this.projectId,
        this.workspaceId,
        this.modelRootPath,
        filePath,
        language,
        'git'
      );
      await modelRegistry.registerModel(
        this.projectId,
        this.workspaceId,
        this.modelRootPath,
        filePath,
        language,
        'buffer'
      );
    }
  }

  private _unregisterModels(bufferUri: string): void {
    modelRegistry.unregisterModel(bufferUri);
    modelRegistry.unregisterModel(modelRegistry.toDiskUri(bufferUri));
    modelRegistry.unregisterModel(modelRegistry.toGitUri(bufferUri, 'HEAD'));
  }
}

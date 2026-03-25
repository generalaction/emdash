import { makeAutoObservable, observable } from 'mobx';
import { ManagedFile } from '../editor/types';
import { FileRendererData, ManagedFileInput, OpenedFile } from '../tasks/types';

export class EditorViewStore {
  openFiles = observable.map<string, ManagedFile>();
  activeFilePath: string | null = null;
  previewFilePath: string | null = null;
  isSaving = false;

  /** Plain (non-observable) map — stable UUID bookkeeping only, does not drive re-renders. */
  readonly tabIds = new Map<string, string>();

  // Persisted navigation state
  expandedPaths = observable.set<string>();

  constructor() {
    makeAutoObservable(this, { tabIds: false });
  }

  /** Projected from openFiles — used for restore on remount. */
  get openedFiles(): OpenedFile[] {
    return Array.from(this.openFiles.values()).map((f) => ({
      tabId: f.tabId,
      path: f.path,
      renderer: f.renderer,
    }));
  }

  get activeTabId(): string | undefined {
    return this.activeFilePath ? this.tabIds.get(this.activeFilePath) : undefined;
  }

  get previewTabId(): string | undefined {
    return this.previewFilePath ? this.tabIds.get(this.previewFilePath) : undefined;
  }

  get activeFile(): ManagedFile | null {
    return this.activeFilePath ? (this.openFiles.get(this.activeFilePath) ?? null) : null;
  }

  get tabs(): Array<{ tabId: string; filePath: string }> {
    return Array.from(this.openFiles.keys()).map((path) => ({
      tabId: this.tabIds.get(path) ?? path,
      filePath: path,
    }));
  }

  /**
   * Inserts or replaces a file entry. Assigns a stable tabId on first open.
   * Callers must pre-seed `tabIds` before calling this when restoring a
   * specific tabId from persisted state.
   */
  setFile(file: ManagedFileInput): void {
    const { path } = file;
    if (!this.tabIds.has(path)) {
      this.tabIds.set(path, crypto.randomUUID());
    }
    this.openFiles.set(path, { ...file, tabId: this.tabIds.get(path)! });
  }

  removeFile(path: string): void {
    this.tabIds.delete(path);
    this.openFiles.delete(path);
    if (this.activeFilePath === path) {
      const keys = Array.from(this.openFiles.keys());
      this.activeFilePath = keys[keys.length - 1] ?? null;
    }
    if (this.previewFilePath === path) {
      this.previewFilePath = null;
    }
  }

  /**
   * Removes a file from openFiles without touching tabIds.
   * Used during atomic preview tab swaps where the outgoing tab's tabId
   * has already been stolen for the incoming file.
   */
  removeFileSilent(path: string): void {
    this.openFiles.delete(path);
    if (this.activeFilePath === path) {
      const keys = Array.from(this.openFiles.keys());
      this.activeFilePath = keys[keys.length - 1] ?? null;
    }
    if (this.previewFilePath === path) {
      this.previewFilePath = null;
    }
  }

  /**
   * Atomically replaces the outgoing preview tab with an incoming file placeholder.
   * Steals the outgoing tab's tabId so React sees a mutation of an existing tab
   * rather than a remove+add, preventing a flash of two tabs.
   *
   * Because makeAutoObservable makes all methods actions, the entire swap runs
   * in a single MobX batch → single React render.
   */
  swapPreviewTab(outgoingPath: string, incoming: ManagedFileInput): void {
    const stolenTabId = this.tabIds.get(outgoingPath);
    if (stolenTabId) {
      this.tabIds.set(incoming.path, stolenTabId);
    }
    this.removeFileSilent(outgoingPath);
    this.setFile(incoming);
    this.previewFilePath = incoming.path;
    this.activeFilePath = incoming.path;
  }

  setActiveFilePath(path: string | null): void {
    this.activeFilePath = path;
  }

  setPreviewFilePath(path: string | null): void {
    this.previewFilePath = path;
  }

  setIsSaving(saving: boolean): void {
    this.isSaving = saving;
  }

  updateRenderer(path: string, updater: (prev: FileRendererData) => FileRendererData): void {
    const f = this.openFiles.get(path);
    if (f) this.openFiles.set(path, { ...f, renderer: updater(f.renderer) });
  }
}

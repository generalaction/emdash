import { makeAutoObservable, observable } from 'mobx';
import type { ManagedFile } from '@renderer/core/editor/types';

export type MainPanelView = 'agents' | 'editor' | 'diff';
export type RightPanelView = 'changes' | 'files' | 'terminals';

export type FileRendererData =
  | { kind: 'text' }
  | { kind: 'markdown' }
  | { kind: 'markdown-source' }
  | { kind: 'svg' }
  | { kind: 'svg-source' }
  | { kind: 'image' }
  | { kind: 'binary' }
  | { kind: 'too-large' };

export type OpenedFile = {
  /** Stable UUID assigned once on first open — used as React key. */
  tabId: string;
  /** Worktree-relative file path (e.g. `src/components/App.tsx`). Not a Monaco URI. */
  path: string;
  /** Renderer kind — determines which component renders this file. */
  renderer: FileRendererData;
};

/** Input shape for EditorViewState.setFile — tabId is managed by the store. */
export type ManagedFileInput = Omit<ManagedFile, 'tabId'>;

export class EditorViewState {
  // Transient runtime state
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

export class AgentsViewState {
  activeConversationId: string | undefined = undefined;

  constructor() {
    makeAutoObservable(this);
  }

  setActiveConversationId(id: string): void {
    this.activeConversationId = id;
  }
}

export class TerminalsViewState {
  activeTerminalId: string | undefined = undefined;

  constructor() {
    makeAutoObservable(this);
  }

  setActiveTerminalId(id: string | undefined): void {
    this.activeTerminalId = id;
  }
}

export class TaskViewState {
  view: MainPanelView = 'agents';
  rightPanelView: RightPanelView = 'changes';
  agentsView = new AgentsViewState();
  terminalsView = new TerminalsViewState();
  editorView = new EditorViewState();

  constructor() {
    makeAutoObservable(this);
  }

  setView(v: MainPanelView): void {
    this.view = v;
  }

  setRightPanelView(v: RightPanelView): void {
    this.rightPanelView = v;
  }
}

class TaskViewStateStore {
  private readonly map = observable.map<string, TaskViewState>();

  getOrCreate(taskId: string): TaskViewState {
    if (!this.map.has(taskId)) {
      this.map.set(taskId, new TaskViewState());
    }
    return this.map.get(taskId)!;
  }

  delete(taskId: string): void {
    this.map.delete(taskId);
  }
}

export const taskViewStateStore = new TaskViewStateStore();

import type * as monaco from 'monaco-editor';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import type { FileWatchEvent } from '@shared/fs';
import { events, rpc } from '@renderer/core/ipc';
import { buildMonacoModelPath } from './monacoModelPath';

type OpenEntry = {
  filePath: string;
  projectId: string;
  taskId: string;
  language: string;
  /** model.getVersionId() at last save — used to derive isDirty */
  savedVersionId: number;
};

type ConflictHandler = (filePath: string, uri: string, newContent: string) => void;

class MonacoModelRegistry {
  /**
   * Text buffers keyed by Monaco URI string.
   * Holds content, undo/redo history, language markers.
   * Lives as long as the tab is open.
   */
  private modelCache = new Map<string, monaco.editor.ITextModel>();

  /**
   * Viewport state keyed by Monaco URI string.
   * Saves cursor position, scroll offset, folding state between file switches.
   * Not persisted to disk.
   */
  private viewStateCache = new Map<string, monaco.editor.ICodeEditorViewState | null>();

  /** Metadata for every open file (no content — content lives in the model). */
  private openEntries = new Map<string, OpenEntry>();

  /** URIs currently being reloaded from disk — suppresses onDidChangeModelContent for those URIs. */
  private reloadingFromDisk = new Set<string>();

  /** Per-task fsWatchEventChannel unsubscribe functions. */
  private watchSubscriptions = new Map<string, () => void>();

  /** Per-task conflict handler callbacks (set by EditorProvider). */
  private conflictHandlers = new Map<string, ConflictHandler>();

  /**
   * Open (or re-open) a file in the registry.
   *
   * If a model already exists for the URI, returns immediately without touching
   * content — this preserves any unsaved edits and the full undo history.
   *
   * @returns the Monaco URI string to be stored by callers
   */
  openFile(
    projectId: string,
    taskId: string,
    modelRootPath: string,
    filePath: string,
    diskContent: string,
    language: string
  ): string {
    const uri = buildMonacoModelPath(modelRootPath, filePath);

    // Never overwrite an existing model — preserves unsaved edits + undo stack.
    if (this.modelCache.has(uri)) {
      return uri;
    }

    // Lazily resolve Monaco from the global singleton (set by monaco-pool init).
    const m = this.getMonaco();
    if (m) {
      const monacoUri = m.Uri.parse(uri);
      let model = m.editor.getModel(monacoUri);
      if (!model) {
        model = m.editor.createModel(diskContent, language, monacoUri);
      }
      this.modelCache.set(uri, model);
      this.openEntries.set(uri, {
        filePath,
        projectId,
        taskId,
        language,
        savedVersionId: model.getVersionId(),
      });
    }

    // Subscribe to fs events for this task on first file open.
    if (!this.watchSubscriptions.has(taskId)) {
      const unsub = events.on(
        fsWatchEventChannel,
        (data) => void this.handleFsEvents(data.taskId, data.events),
        taskId
      );
      this.watchSubscriptions.set(taskId, unsub);
    }

    // Update the 'editor' label watcher to watch only this task's open files.
    this.syncWatchedPaths(projectId, taskId);

    return uri;
  }

  /**
   * Attach the correct model to a leased editor for a given URI.
   *
   * - Saves the view state for `previousUri` before switching.
   * - Restores the saved view state for `newUri` if available.
   */
  attach(editor: monaco.editor.IStandaloneCodeEditor, newUri: string, previousUri?: string): void {
    if (previousUri && previousUri !== newUri) {
      this.viewStateCache.set(previousUri, editor.saveViewState());
    }

    const model = this.modelCache.get(newUri);
    if (model) {
      editor.setModel(model);
    }

    const savedViewState = this.viewStateCache.get(newUri);
    if (savedViewState) {
      editor.restoreViewState(savedViewState);
    }
  }

  getModel(uri: string): monaco.editor.ITextModel | undefined {
    return this.modelCache.get(uri);
  }

  /** Returns true if the model has unsaved changes. */
  isDirty(uri: string): boolean {
    const model = this.modelCache.get(uri);
    const entry = this.openEntries.get(uri);
    if (!model || !entry) return false;
    return model.getVersionId() !== entry.savedVersionId;
  }

  /** Record the current version as saved. */
  markSaved(uri: string): void {
    const model = this.modelCache.get(uri);
    const entry = this.openEntries.get(uri);
    if (model && entry) {
      entry.savedVersionId = model.getVersionId();
    }
  }

  /** Get the current text content of the model. */
  getValue(uri: string): string | null {
    return this.modelCache.get(uri)?.getValue() ?? null;
  }

  /**
   * Silently update the model to reflect external disk changes.
   * Only call this when `isDirty(uri)` is false.
   *
   * Sets `reloadingFromDisk` before calling `model.setValue()` so that
   * `PooledCodeEditor`'s `onDidChangeModelContent` listener can skip
   * treating the programmatic reload as a user edit. The flag is cleared
   * synchronously after `setValue` returns (Monaco fires the event synchronously).
   */
  reloadFromDisk(uri: string, newContent: string): void {
    const model = this.modelCache.get(uri);
    const entry = this.openEntries.get(uri);
    if (model && entry) {
      this.reloadingFromDisk.add(uri);
      model.setValue(newContent);
      entry.savedVersionId = model.getVersionId();
      this.reloadingFromDisk.delete(uri);
    }
  }

  /** Returns true while a programmatic disk reload is in progress for this URI. */
  isReloadingFromDisk(uri: string): boolean {
    return this.reloadingFromDisk.has(uri);
  }

  /** Close a single file: dispose its model and clear caches. */
  closeFile(uri: string): void {
    const entry = this.openEntries.get(uri);
    const model = this.modelCache.get(uri);
    if (model && !model.isDisposed()) {
      model.dispose();
    }
    this.modelCache.delete(uri);
    this.viewStateCache.delete(uri);
    this.openEntries.delete(uri);
    // Update watched paths after removing this file.
    if (entry) {
      this.syncWatchedPaths(entry.projectId, entry.taskId);
    }
  }

  /** Close all files belonging to a specific task. */
  closeAllForTask(projectId: string, taskId: string): void {
    // Collect URIs first to avoid mutating map during iteration.
    const uris = [...this.openEntries.entries()]
      .filter(([, e]) => e.projectId === projectId && e.taskId === taskId)
      .map(([uri]) => uri);

    for (const uri of uris) {
      const model = this.modelCache.get(uri);
      if (model && !model.isDisposed()) {
        model.dispose();
      }
      this.modelCache.delete(uri);
      this.viewStateCache.delete(uri);
      this.openEntries.delete(uri);
    }

    // Clean up fs event subscription and stop the editor watcher.
    this.watchSubscriptions.get(taskId)?.();
    this.watchSubscriptions.delete(taskId);
    this.conflictHandlers.delete(taskId);
    rpc.fs.watchStop(projectId, taskId, 'editor', 'files').catch(() => {});
  }

  /** Save the current view state for a URI (e.g. on tab blur). */
  saveViewState(uri: string, viewState: monaco.editor.ICodeEditorViewState | null): void {
    this.viewStateCache.set(uri, viewState);
  }

  /** Returns true if the registry has an open model for this URI. */
  hasModel(uri: string): boolean {
    return this.modelCache.has(uri);
  }

  /**
   * Register a callback to be invoked when an open file has been externally
   * modified while the model is dirty. Returns an unsubscribe function.
   */
  setConflictHandler(taskId: string, cb: ConflictHandler): () => void {
    this.conflictHandlers.set(taskId, cb);
    return () => this.conflictHandlers.delete(taskId);
  }

  /** Call watchSetPaths for the 'editor' label with this task's current open file paths. */
  private syncWatchedPaths(projectId: string, taskId: string): void {
    const paths = [...this.openEntries.values()]
      .filter((e) => e.taskId === taskId)
      .map((e) => e.filePath);
    rpc.fs.watchSetPaths(projectId, taskId, paths, 'editor', 'files').catch(() => {});
  }

  private async handleFsEvents(taskId: string, fsEvents: FileWatchEvent[]): Promise<void> {
    for (const event of fsEvents.filter((e) => e.type === 'modify')) {
      const found = this.findEntryByTaskAndPath(taskId, event.path);
      if (!found) continue;
      const { uri, entry } = found;
      const result = await rpc.fs.readFile(entry.projectId, taskId, event.path);
      if (!result.success) continue;
      const newContent = result.data.content;
      if (this.isDirty(uri)) {
        this.conflictHandlers.get(taskId)?.(event.path, uri, newContent);
      } else {
        this.reloadFromDisk(uri, newContent);
      }
    }
  }

  private findEntryByTaskAndPath(
    taskId: string,
    filePath: string
  ): { uri: string; entry: OpenEntry } | undefined {
    for (const [uri, entry] of this.openEntries) {
      if (entry.taskId === taskId && entry.filePath === filePath) return { uri, entry };
    }
    return undefined;
  }

  private getMonaco(): typeof monaco | null {
    // The registry is module-level; Monaco is loaded asynchronously by the pool.
    // Access via the global set by monaco-pool when it initialises.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__monaco ?? null;
  }
}

export const modelRegistry = new MonacoModelRegistry();

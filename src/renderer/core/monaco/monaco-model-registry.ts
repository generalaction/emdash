import type * as monaco from 'monaco-editor';
import { gitStatusChangedChannel } from '@shared/events/appEvents';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import type { FileWatchEvent } from '@shared/fs';
import { events, rpc } from '@renderer/core/ipc';
import { buildMonacoModelPath } from '../../lib/monacoModelPath';

// ---------------------------------------------------------------------------
// Entry types — each model type gets its own typed wrapper
// ---------------------------------------------------------------------------

type BufferEntry = {
  model: monaco.editor.ITextModel;
  /** Monaco cursor/scroll/folding state, saved between tab switches. */
  viewState: monaco.editor.ICodeEditorViewState | null;
};

type DiskEntry = { model: monaco.editor.ITextModel };
type GitBaseEntry = { model: monaco.editor.ITextModel };

export type ModelType = 'buffer' | 'disk' | 'gitBase';

/** Metadata needed for watcher sync and FS operations. Keyed by buffer URI. Set when disk is registered. */
type OpenEntry = {
  filePath: string;
  projectId: string;
  taskId: string;
  language: string;
};

/**
 * Manages up to three Monaco ITextModel instances per open file.
 *
 *   buffer  (file://)  — writable; shown in the code editor; holds user edits + undo stack
 *   disk    (disk://)  — read-only mirror of the current on-disk content; updated by watcher
 *   gitBase (base://)  — read-only snapshot of git HEAD; updated when HEAD changes
 *
 * Models are created/destroyed via `registerModel` / `unregisterModel`. Both are reference-
 * counted so disk models shared between the editor and the diff panel are disposed only
 * when the last consumer unregisters.
 *
 * Registrations are driven by React callers:
 *   EditorProvider   → 'disk' + 'buffer'  (awaits register before setOpenFiles)
 *   FileDiffView     → 'disk' + 'gitBase' (useEffect on activeFile)
 */
class MonacoModelRegistry {
  private bufferCache = new Map<string, BufferEntry>();
  private diskCache = new Map<string, DiskEntry>();
  private gitBaseCache = new Map<string, GitBaseEntry>();

  private bufferRefs = new Map<string, number>();
  private diskRefs = new Map<string, number>();
  private gitBaseRefs = new Map<string, number>();

  private openEntries = new Map<string, OpenEntry>();

  private reloadingFromDisk = new Set<string>();

  /**
   * URIs where the file was externally modified while the buffer had unsaved edits.
   * The conflict dialog is deferred until the user attempts to save the file.
   */
  private pendingConflicts = new Set<string>();

  /** fsWatchEventChannel unsubscribe functions, keyed by taskId */
  private diskWatchSubs = new Map<string, () => void>();

  /** gitStatusChangedChannel unsubscribe functions, keyed by taskId */
  private gitBaseWatchSubs = new Map<string, () => void>();

  private bufferReadyCallbacks = new Map<string, Array<() => void>>();

  private toDiskUri(bufferUri: string): string {
    return bufferUri.replace(/^file:\/\//, 'disk://');
  }

  private toBaseUri(bufferUri: string): string {
    return bufferUri.replace(/^file:\/\//, 'base://');
  }

  /**
   * Register (or increment the reference count of) a model for `filePath`.
   *
   * - `'disk'`    — fetches disk content via RPC, creates `disk://` model, subscribes task to
   *                 fsWatchEventChannel
   * - `'gitBase'` — fetches HEAD content via RPC; skipped silently for untracked files (null).
   *                 Creates `base://` model, subscribes task to gitStatusChangedChannel
   * - `'buffer'`  — seeds from the existing disk model (disk must be registered first).
   *                 Creates `file://` model, fires any queued `onceBufferReady` callbacks
   *
   * Idempotent: if the model already exists, just increments ref count and returns the URI.
   *
   * @returns the buffer URI string (same for all three types of the same file)
   */
  async registerModel(
    projectId: string,
    taskId: string,
    modelRootPath: string,
    filePath: string,
    language: string,
    type: ModelType
  ): Promise<string> {
    const uri = buildMonacoModelPath(modelRootPath, filePath);

    switch (type) {
      case 'disk':
        return this.registerDisk(projectId, taskId, uri, filePath, language);
      case 'gitBase':
        return this.registerGitBase(projectId, taskId, uri, filePath, language);
      case 'buffer':
        return this.registerBuffer(uri, language);
    }
  }

  private async registerDisk(
    projectId: string,
    taskId: string,
    uri: string,
    filePath: string,
    language: string
  ): Promise<string> {
    const prev = this.diskRefs.get(uri) ?? 0;
    this.diskRefs.set(uri, prev + 1);

    // Already exists — just bump ref count.
    if (prev > 0) return uri;

    const result = await rpc.fs.readFile(projectId, taskId, filePath);
    if (!result.success) {
      this.diskRefs.set(uri, prev); // roll back
      throw new Error(`registerModel(disk): readFile failed for ${filePath}: ${result.error}`);
    }
    const content = result.data.content;

    const m = this.getMonaco();
    if (m) {
      const diskMonacoUri = m.Uri.parse(this.toDiskUri(uri));
      let model = m.editor.getModel(diskMonacoUri);
      if (!model) {
        model = m.editor.createModel(content, language, diskMonacoUri);
      }
      this.diskCache.set(uri, { model });
    }

    this.openEntries.set(uri, { filePath, projectId, taskId, language });

    if (!this.diskWatchSubs.has(taskId)) {
      const unsub = events.on(
        fsWatchEventChannel,
        (data) => void this.handleFsEvents(data.taskId, data.events),
        taskId
      );
      this.diskWatchSubs.set(taskId, unsub);
    }

    this.syncDiskWatchedPaths(projectId, taskId);
    return uri;
  }

  private async registerGitBase(
    projectId: string,
    taskId: string,
    uri: string,
    filePath: string,
    language: string
  ): Promise<string> {
    const prev = this.gitBaseRefs.get(uri) ?? 0;
    this.gitBaseRefs.set(uri, prev + 1);

    if (prev > 0) return uri;

    const result = await rpc.git.getFileAtHead(projectId, taskId, filePath);
    // Silently skip new/untracked files with no HEAD content.
    if (!result.success || result.data.content === null) {
      // Keep ref count at 1 so unregister still works cleanly.
      return uri;
    }

    const content = result.data.content;
    const m = this.getMonaco();
    if (m) {
      const baseMonacoUri = m.Uri.parse(this.toBaseUri(uri));
      let model = m.editor.getModel(baseMonacoUri);
      if (!model) {
        model = m.editor.createModel(content, language, baseMonacoUri);
      }
      this.gitBaseCache.set(uri, { model });
    }

    // Ensure task-level git HEAD subscription.
    if (!this.gitBaseWatchSubs.has(taskId)) {
      const entry = this.openEntries.get(uri);
      const pId = entry?.projectId ?? projectId;
      const unsub = events.on(gitStatusChangedChannel, () => {
        void this.refreshGitBaseModelsForTask(pId, taskId);
      });
      this.gitBaseWatchSubs.set(taskId, unsub);
    }

    this.syncGitBaseWatchedPaths(projectId, taskId);
    return uri;
  }

  private registerBuffer(uri: string, language: string): string {
    const prev = this.bufferRefs.get(uri) ?? 0;
    this.bufferRefs.set(uri, prev + 1);

    if (prev > 0) return uri;

    // Seed content from disk model (disk must be registered first).
    const diskModel = this.diskCache.get(uri)?.model;
    const seedContent = diskModel ? diskModel.getValue() : '';

    const m = this.getMonaco();
    if (m) {
      const bufferMonacoUri = m.Uri.parse(uri);
      let model = m.editor.getModel(bufferMonacoUri);
      if (!model) {
        model = m.editor.createModel(seedContent, language, bufferMonacoUri);
      }
      this.bufferCache.set(uri, { model, viewState: null });
    }

    // Fire any deferred attach callbacks registered by PooledCodeEditor.
    const callbacks = this.bufferReadyCallbacks.get(uri);
    if (callbacks?.length) {
      callbacks.forEach((cb) => cb());
      this.bufferReadyCallbacks.delete(uri);
    }

    return uri;
  }

  /**
   * Decrement the reference count for a model type. Disposes the Monaco model
   * and cleans up subscriptions when count reaches 0.
   */
  unregisterModel(uri: string, type: ModelType): void {
    switch (type) {
      case 'disk':
        this.unregisterDisk(uri);
        break;
      case 'gitBase':
        this.unregisterGitBase(uri);
        break;
      case 'buffer':
        this.unregisterBuffer(uri);
        break;
    }
  }

  private unregisterDisk(uri: string): void {
    const count = this.diskRefs.get(uri) ?? 0;
    if (count <= 0) return;

    const next = count - 1;
    this.diskRefs.set(uri, next);

    if (next > 0) return;

    const entry = this.openEntries.get(uri);
    const diskModel = this.diskCache.get(uri)?.model;
    if (diskModel && !diskModel.isDisposed()) diskModel.dispose();
    this.diskCache.delete(uri);
    this.diskRefs.delete(uri);
    this.openEntries.delete(uri);

    if (!entry) return;
    const { projectId, taskId } = entry;

    // Re-sync watched paths; unsubscribe task watcher if no disk models remain.
    const remainingForTask = this.diskModelsForTask(taskId);
    if (remainingForTask.length === 0) {
      this.diskWatchSubs.get(taskId)?.();
      this.diskWatchSubs.delete(taskId);
      rpc.fs.watchStop(projectId, taskId, 'disk', 'files').catch(() => {});
    } else {
      this.syncDiskWatchedPaths(projectId, taskId);
    }
  }

  private unregisterGitBase(uri: string): void {
    const count = this.gitBaseRefs.get(uri) ?? 0;
    if (count <= 0) return;

    const next = count - 1;
    this.gitBaseRefs.set(uri, next);

    if (next > 0) return;

    const baseModel = this.gitBaseCache.get(uri)?.model;
    if (baseModel && !baseModel.isDisposed()) baseModel.dispose();
    this.gitBaseCache.delete(uri);
    this.gitBaseRefs.delete(uri);

    // Unsubscribe task gitBase watcher if no gitBase models remain for the task.
    const entry = this.openEntries.get(uri);
    if (!entry) return;
    const { projectId, taskId } = entry;
    const remaining = this.gitBaseModelsForTask(taskId);
    if (remaining.length === 0) {
      this.gitBaseWatchSubs.get(taskId)?.();
      this.gitBaseWatchSubs.delete(taskId);
    }
    this.syncGitBaseWatchedPaths(projectId, taskId);
  }

  private unregisterBuffer(uri: string): void {
    const count = this.bufferRefs.get(uri) ?? 0;
    if (count <= 0) return;

    const next = count - 1;
    this.bufferRefs.set(uri, next);

    if (next > 0) return;

    const bufferModel = this.bufferCache.get(uri)?.model;
    if (bufferModel && !bufferModel.isDisposed()) bufferModel.dispose();
    this.bufferCache.delete(uri);
    this.bufferRefs.delete(uri);
    // Cancel any pending attach callbacks and pending conflict for this URI.
    this.bufferReadyCallbacks.delete(uri);
    this.pendingConflicts.delete(uri);
  }

  // ---------------------------------------------------------------------------
  // Attach / view state
  // ---------------------------------------------------------------------------

  /**
   * Attach the buffer model to a leased code editor.
   * Saves view state for `previousUri` and restores it for `newUri`.
   */
  attach(editor: monaco.editor.IStandaloneCodeEditor, newUri: string, previousUri?: string): void {
    if (previousUri && previousUri !== newUri) {
      const prev = this.bufferCache.get(previousUri);
      if (prev) prev.viewState = editor.saveViewState();
    }

    const entry = this.bufferCache.get(newUri);
    if (entry) {
      editor.setModel(entry.model);
      if (entry.viewState) {
        editor.restoreViewState(entry.viewState);
      }
    }
  }

  /**
   * Register a one-shot callback that fires when the buffer model for `uri` is created.
   * If the model already exists, fires immediately.
   * Returns a cleanup function that cancels the pending callback.
   */
  onceBufferReady(uri: string, cb: () => void): () => void {
    if (this.bufferCache.has(uri)) {
      cb();
      return () => {};
    }
    const cbs = this.bufferReadyCallbacks.get(uri) ?? [];
    cbs.push(cb);
    this.bufferReadyCallbacks.set(uri, cbs);
    return () => {
      const current = this.bufferReadyCallbacks.get(uri);
      if (!current) return;
      const filtered = current.filter((c) => c !== cb);
      if (filtered.length === 0) {
        this.bufferReadyCallbacks.delete(uri);
      } else {
        this.bufferReadyCallbacks.set(uri, filtered);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Dirty state
  // ---------------------------------------------------------------------------

  /** Returns true if the buffer has unsaved changes relative to on-disk content. */
  isDirty(uri: string): boolean {
    const buf = this.bufferCache.get(uri)?.model;
    const disk = this.diskCache.get(uri)?.model;
    if (!buf || !disk) return false;
    return buf.getValue() !== disk.getValue();
  }

  /**
   * Mark the current buffer content as saved.
   * Syncs the disk model to match the buffer so isDirty() returns false.
   */
  markSaved(uri: string): void {
    const buf = this.bufferCache.get(uri)?.model;
    const disk = this.diskCache.get(uri)?.model;
    if (buf && disk) {
      disk.setValue(buf.getValue());
    }
  }

  // ---------------------------------------------------------------------------
  // Content access
  // ---------------------------------------------------------------------------

  /** Get the buffer (editable) model — used by the code editor pool. */
  getModel(uri: string): monaco.editor.ITextModel | undefined {
    return this.bufferCache.get(uri)?.model;
  }

  /** Get the disk model (current on-disk snapshot) — used as 'modified' in diff viewer. */
  getDiskModel(uri: string): monaco.editor.ITextModel | undefined {
    return this.diskCache.get(uri)?.model;
  }

  /** Get the git base model (HEAD snapshot) — used as 'original' in diff viewer. */
  getGitBaseModel(uri: string): monaco.editor.ITextModel | undefined {
    return this.gitBaseCache.get(uri)?.model;
  }

  /** Current text content of the buffer model. */
  getValue(uri: string): string | null {
    return this.bufferCache.get(uri)?.model.getValue() ?? null;
  }

  /** Current text content of the disk model. */
  getDiskValue(uri: string): string | null {
    return this.diskCache.get(uri)?.model.getValue() ?? null;
  }

  /** True if a buffer model is registered for this URI. */
  hasModel(uri: string): boolean {
    return this.bufferCache.has(uri);
  }

  /** True while a programmatic disk reload is in progress (suppresses false dirty flag). */
  isReloadingFromDisk(uri: string): boolean {
    return this.reloadingFromDisk.has(uri);
  }

  // ---------------------------------------------------------------------------
  // Reload from disk (called after "Accept Incoming" in conflict dialog)
  // ---------------------------------------------------------------------------

  /**
   * Copy disk model content into the buffer model.
   * Sets reloadingFromDisk so PooledCodeEditor's onDidChangeModelContent listener
   * skips treating this as a user edit.
   */
  reloadFromDisk(uri: string): void {
    const buf = this.bufferCache.get(uri)?.model;
    const disk = this.diskCache.get(uri)?.model;
    if (buf && disk) {
      this.reloadingFromDisk.add(uri);
      buf.setValue(disk.getValue());
      this.reloadingFromDisk.delete(uri);
    }
    // Conflict is resolved — the incoming change was accepted.
    this.pendingConflicts.delete(uri);
  }

  /**
   * Write the buffer content to disk, sync the disk model, and clear the
   * crash-recovery buffer entry. The mirror of `reloadFromDisk`.
   *
   * @returns the saved content string on success, or `null` on failure.
   *          The caller is responsible for updating any React dirty-state.
   */
  async saveFileToDisk(uri: string): Promise<string | null> {
    const buf = this.bufferCache.get(uri)?.model;
    const entry = this.openEntries.get(uri);
    if (!buf || !entry) return null;

    const content = buf.getValue();
    const result = await rpc.fs.writeFile(entry.projectId, entry.taskId, entry.filePath, content);
    if (!result.success) return null;

    // Keep disk model in sync so isDirty() immediately returns false.
    this.markSaved(uri);
    // Conflict is resolved — the user's version won.
    this.pendingConflicts.delete(uri);
    // Crash-recovery buffer is no longer needed once the file is on disk.
    void rpc.editorBuffer.clearBuffer(entry.projectId, entry.taskId, entry.filePath);
    return content;
  }

  // ---------------------------------------------------------------------------
  // Conflict state
  // ---------------------------------------------------------------------------

  /**
   * Returns true if the file was externally modified while the buffer had
   * unsaved edits. The conflict dialog is shown lazily, only when the user
   * tries to save, so normal editing is never interrupted.
   *
   * Cleared automatically by `reloadFromDisk`, `saveFileToDisk`, and
   * `unregisterBuffer` (file closed).
   */
  hasPendingConflict(uri: string): boolean {
    return this.pendingConflicts.has(uri);
  }

  // ---------------------------------------------------------------------------
  // Git base refresh (called by EditorProvider on gitStatusChangedChannel)
  // ---------------------------------------------------------------------------

  /**
   * Re-fetches HEAD content for all open files in a task.
   * Also called internally when the per-task gitBase subscription fires.
   */
  async refreshGitBaseModels(projectId: string, taskId: string): Promise<void> {
    return this.refreshGitBaseModelsForTask(projectId, taskId);
  }

  private async refreshGitBaseModelsForTask(projectId: string, taskId: string): Promise<void> {
    const entries = [...this.openEntries.entries()].filter(
      ([, e]) => e.projectId === projectId && e.taskId === taskId
    );

    for (const [uri, entry] of entries) {
      if (!this.gitBaseCache.has(uri)) continue;

      const result = await rpc.git.getFileAtHead(projectId, taskId, entry.filePath);
      if (!result.success || result.data.content === null) continue;

      const newContent = result.data.content;
      const existing = this.gitBaseCache.get(uri);
      if (existing) {
        if (existing.model.getValue() !== newContent) {
          existing.model.setValue(newContent);
        }
      } else {
        const m = this.getMonaco();
        if (m) {
          const baseUri = m.Uri.parse(this.toBaseUri(uri));
          const model = m.editor.createModel(newContent, entry.language, baseUri);
          this.gitBaseCache.set(uri, { model });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // File watcher sync
  // ---------------------------------------------------------------------------

  private syncDiskWatchedPaths(projectId: string, taskId: string): void {
    const paths = this.diskModelsForTask(taskId).map((e) => e.filePath);
    rpc.fs.watchSetPaths(projectId, taskId, paths, 'disk', 'files').catch(() => {});
  }

  private syncGitBaseWatchedPaths(_projectId: string, _taskId: string): void {
    // Reserved for future .git folder watching to keep gitBase models up-to-date.
    // No-op until that watcher is wired.
  }

  private async handleFsEvents(taskId: string, fsEvents: FileWatchEvent[]): Promise<void> {
    for (const event of fsEvents.filter((e) => e.type === 'modify')) {
      const found = this.findEntryByTaskAndPath(taskId, event.path);
      if (!found) continue;
      const { uri, entry } = found;

      const result = await rpc.fs.readFile(entry.projectId, taskId, event.path);
      if (!result.success) continue;
      const newContent = result.data.content;

      // Snapshot dirty state and buffer value BEFORE updating the disk model.
      // If we checked isDirty() after, a clean buffer would appear dirty because
      // the disk model would already hold the new (different) external content.
      const wasDirty = this.isDirty(uri);
      const bufValue = this.bufferCache.get(uri)?.model.getValue();
      const newMatchesBuffer = bufValue === newContent;

      // 1. Always update the disk model — ground truth for "what's on disk".
      const diskEntry = this.diskCache.get(uri);
      if (diskEntry) {
        diskEntry.model.setValue(newContent);
      }

      if (!wasDirty || newMatchesBuffer) {
        // 2a. Buffer is clean, or agent wrote exactly what the user had typed
        //     → pull buffer forward silently; no conflict needed.
        const bufferEntry = this.bufferCache.get(uri);
        if (bufferEntry) {
          this.reloadingFromDisk.add(uri);
          bufferEntry.model.setValue(newContent);
          this.reloadingFromDisk.delete(uri);
        }
      } else {
        // 2b. Buffer has genuine user edits that differ from the new disk content.
        //     Mark as pending conflict — the dialog is deferred until the user
        //     tries to save, so editing is not interrupted mid-keystroke.
        this.pendingConflicts.add(uri);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private diskModelsForTask(taskId: string): OpenEntry[] {
    return [...this.openEntries.values()].filter((e) => e.taskId === taskId);
  }

  private gitBaseModelsForTask(taskId: string): OpenEntry[] {
    return [...this.openEntries.entries()]
      .filter(([uri, e]) => e.taskId === taskId && this.gitBaseCache.has(uri))
      .map(([, e]) => e);
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
    // Registry is module-level; Monaco is loaded asynchronously by the pool.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__monaco ?? null;
  }
}

export const modelRegistry = new MonacoModelRegistry();

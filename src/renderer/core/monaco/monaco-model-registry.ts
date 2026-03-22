import type * as monaco from 'monaco-editor';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import type { FileWatchEvent } from '@shared/fs';
import { events, rpc } from '@renderer/core/ipc';
import { buildMonacoModelPath } from './monacoModelPath';

const BUFFER_DEBOUNCE_MS = 2000;

// ---------------------------------------------------------------------------
// Discriminated-union entry types
// ---------------------------------------------------------------------------

export interface BufferModelEntry {
  type: 'buffer';
  model: monaco.editor.ITextModel;
  /** Monaco cursor/scroll/folding state, saved between tab switches. */
  viewState: monaco.editor.ICodeEditorViewState | null;
  refs: number;
  projectId: string;
  taskId: string;
  filePath: string;
  language: string;
}

export interface DiskModelEntry {
  type: 'disk';
  model: monaco.editor.ITextModel;
  refs: number;
  projectId: string;
  taskId: string;
  filePath: string;
  language: string;
}

export interface GitModelEntry {
  type: 'git';
  model: monaco.editor.ITextModel;
  refs: number;
  projectId: string;
  taskId: string;
  filePath: string;
  language: string;
  /** The git ref — 'HEAD' for the current commit; any ref string for PR/merge-target diffs. */
  ref: string;
}

export type ModelEntry = BufferModelEntry | DiskModelEntry | GitModelEntry;
export type ModelType = 'buffer' | 'disk' | 'gitBase' | 'git';
export type ModelStatus = 'loading' | 'ready' | 'error';

/**
 * Manages up to three Monaco ITextModel instances per open file using a single
 * unified map keyed by Monaco URI string.
 *
 *   buffer  (file://)  — writable; shown in the code editor; holds user edits + undo stack
 *   disk    (disk://)  — read-only mirror of the current on-disk content; updated by watcher
 *   git     (git://)   — read-only snapshot of a git ref (HEAD or arbitrary ref)
 *
 * ### Two-layer lifecycle
 *
 * **Registration** (`registerModel` / `unregisterModel`): purely loads and caches content.
 * Ref-counted. No FS watching or polling until a React subscriber appears.
 *
 * **Subscription** (`subscribeToUri`): the React integration point for `useSyncExternalStore`.
 * When subscriber count goes 0→1 for a URI, FS watching and polling start for that task.
 * When count goes 1→0, watching stops and a 60 s TTL eviction timer starts.
 * This means only models currently visible in the UI consume FS resources.
 *
 * Binary files must be filtered by callers before registering (use `getFileKind` from fileKind.ts).
 */
class MonacoModelRegistry {
  /**
   * Unified model map. Key is the Monaco URI string (scheme encodes entry type).
   *   file://  → BufferModelEntry
   *   disk://  → DiskModelEntry
   *   git://   → GitModelEntry
   */
  private modelMap = new Map<string, ModelEntry>();

  private reloadingFromDisk = new Set<string>();

  /**
   * URIs where the file was externally modified while the buffer had unsaved edits.
   * The conflict dialog is deferred until the user attempts to save the file.
   */
  private pendingConflicts = new Set<string>();

  /**
   * fsWatchEventChannel subscriptions, keyed by taskId.
   * Kept alive while any disk paths or git-head dirs are being watched for the task.
   */
  private fsEventSubs = new Map<string, () => void>();

  private bufferReadyCallbacks = new Map<string, Array<() => void>>();

  /**
   * In-flight fetch deduplication. Prevents duplicate RPCs when two callers
   * register the same file concurrently before either resolves.
   * Key: `{projectId}:{taskId}:{filePath}:disk` or `…:git:{ref}`
   */
  private pendingFetches = new Map<string, Promise<string | null>>();

  // ---------------------------------------------------------------------------
  // Subscription groups (mirror of FS controller's labeledPaths)
  // ---------------------------------------------------------------------------

  /** taskId → Set<filePath> currently in the 'disk' file-watch group */
  private diskSubscribedByTask = new Map<string, Set<string>>();

  /** Tasks whose .git dir is currently in the 'git-head' dir-watch group */
  private gitHeadWatchedTasks = new Set<string>();

  // ---------------------------------------------------------------------------
  // Per-task polling fallback
  // ---------------------------------------------------------------------------

  private taskPollers = new Map<string, ReturnType<typeof setInterval>>();

  // ---------------------------------------------------------------------------
  // React subscription (SWR layer)
  // ---------------------------------------------------------------------------

  /** useSyncExternalStore listeners keyed by typed URI */
  private listeners = new Map<string, Set<() => void>>();

  /** Number of active useSyncExternalStore subscribers per typed URI */
  private subscriberCt = new Map<string, number>();

  /** Model loading status — driven by registerDisk/registerGit */
  private modelStatus = new Map<string, ModelStatus>();

  /**
   * 60 s TTL timers. Started when subscriber count drops to 0.
   * When fired, orphaned models (refs ≤ 0) are cleaned up.
   * Cancelled when a new subscriber arrives or when unregisterModel disposes the model.
   */
  private evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Debounce timers for crash-recovery buffer autosave, keyed by buffer URI. */
  private bufferAutosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** model.onDidChangeContent disposables for each registered buffer, keyed by buffer URI. */
  private bufferContentDisposables = new Map<string, { dispose(): void }>();

  // ---------------------------------------------------------------------------
  // URI helpers (public)
  // ---------------------------------------------------------------------------

  toDiskUri(bufferUri: string): string {
    return bufferUri.replace(/^file:\/\//, 'disk://');
  }

  /**
   * Convert a buffer URI (file://) to a git:// URI for the given ref.
   * Ref is percent-encoded so slashes in branch names (e.g. origin/main) are safe.
   * Example: file://task:abc/src/index.ts + ref='HEAD' → git://task:abc/HEAD/src/index.ts
   */
  toGitUri(bufferUri: string, ref: string): string {
    const withoutScheme = bufferUri.replace(/^file:\/\//, '');
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx < 0) return bufferUri;
    const root = withoutScheme.slice(0, slashIdx);
    const filePath = withoutScheme.slice(slashIdx + 1);
    return `git://${root}/${encodeURIComponent(ref)}/${filePath}`;
  }

  // ---------------------------------------------------------------------------
  // React subscription API (used by useSyncExternalStore hooks in use-model.ts)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to change notifications for a typed URI. Drives FS watching:
   * count 0→1 starts watching; count 1→0 stops watching and starts 60 s TTL.
   *
   * Use via `useSyncExternalStore` hooks in `use-model.ts`, not directly.
   * Returns a cleanup function for the subscription.
   */
  subscribeToUri(uri: string, cb: () => void): () => void {
    // Register listener.
    let listenerSet = this.listeners.get(uri);
    if (!listenerSet) {
      listenerSet = new Set();
      this.listeners.set(uri, listenerSet);
    }
    listenerSet.add(cb);

    const prev = this.subscriberCt.get(uri) ?? 0;
    this.subscriberCt.set(uri, prev + 1);

    if (prev === 0) {
      // Cancel any pending eviction timer.
      const timer = this.evictionTimers.get(uri);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.evictionTimers.delete(uri);
      }
      // Activate FS watching if model already exists; otherwise it activates
      // from registerDisk/registerGit once the model entry is created.
      this.activateUriWatch(uri);
    }

    return () => {
      const curr = this.subscriberCt.get(uri) ?? 0;
      const next = Math.max(0, curr - 1);

      const currentListeners = this.listeners.get(uri);
      currentListeners?.delete(cb);
      if (currentListeners && !currentListeners.size) {
        this.listeners.delete(uri);
      }

      if (next === 0) {
        this.subscriberCt.delete(uri);
        // Stop FS watching immediately.
        this.deactivateUriWatch(uri);
        // Start 60 s TTL — cleans up orphaned prefetch models (refs ≤ 0).
        const t = setTimeout(() => {
          this.evictionTimers.delete(uri);
          const entry = this.modelMap.get(uri);
          if (!entry || entry.refs > 0) return;
          if (!entry.model.isDisposed()) entry.model.dispose();
          this.modelMap.delete(uri);
          this.modelStatus.delete(uri);
        }, 60_000);
        this.evictionTimers.set(uri, t);
      } else {
        this.subscriberCt.set(uri, next);
      }
    };
  }

  /** Snapshot of the model's load status — used as the `getSnapshot` arg to useSyncExternalStore. */
  getStatus(uri: string): ModelStatus {
    return this.modelStatus.get(uri) ?? 'loading';
  }

  /** Returns core metadata for a registered model — used by PooledCodeEditor to read projectId/taskId/filePath. */
  getEntryMeta(uri: string): { projectId: string; taskId: string; filePath: string } | undefined {
    const entry = this.modelMap.get(uri);
    if (!entry) return undefined;
    return { projectId: entry.projectId, taskId: entry.taskId, filePath: entry.filePath };
  }

  // ---------------------------------------------------------------------------
  // Internal notification
  // ---------------------------------------------------------------------------

  private notify(uri: string): void {
    this.listeners.get(uri)?.forEach((cb) => cb());
  }

  // ---------------------------------------------------------------------------
  // FS watch activation / deactivation (driven by subscribeToUri)
  // ---------------------------------------------------------------------------

  private activateUriWatch(uri: string): void {
    const entry = this.modelMap.get(uri);
    if (!entry) return; // model still loading; registerDisk/registerGit will call this after creation

    if (entry.type === 'disk') {
      const set = this.diskSubscribedByTask.get(entry.taskId) ?? new Set<string>();
      if (!set.has(entry.filePath)) {
        set.add(entry.filePath);
        this.diskSubscribedByTask.set(entry.taskId, set);
        this.ensureFsEventSub(entry.projectId, entry.taskId);
        this.syncDiskWatchedPaths(entry.projectId, entry.taskId);
      }
      this.startPoller(entry.projectId, entry.taskId);
    } else if (entry.type === 'git' && entry.ref === 'HEAD') {
      if (!this.gitHeadWatchedTasks.has(entry.taskId)) {
        void rpc.fs.watchSetPaths(entry.projectId, entry.taskId, ['.git'], 'git-head', 'dirs');
        this.gitHeadWatchedTasks.add(entry.taskId);
        this.ensureFsEventSub(entry.projectId, entry.taskId);
      }
      this.startPoller(entry.projectId, entry.taskId);
    }
    // buffer: no FS watching side effect
  }

  private deactivateUriWatch(uri: string): void {
    const entry = this.modelMap.get(uri);
    if (!entry) return;

    if (entry.type === 'disk') {
      this.diskSubscribedByTask.get(entry.taskId)?.delete(entry.filePath);
      const set = this.diskSubscribedByTask.get(entry.taskId);
      if (!set?.size) {
        this.diskSubscribedByTask.delete(entry.taskId);
        void rpc.fs.watchStop(entry.projectId, entry.taskId, 'disk', 'files');
      } else {
        this.syncDiskWatchedPaths(entry.projectId, entry.taskId);
      }
      this.maybeCleanupFsEventSub(entry.taskId);
      this.maybeStopPoller(entry.taskId);
    } else if (entry.type === 'git' && entry.ref === 'HEAD') {
      if (
        !this.taskHasGitHeadSubscribers(entry.taskId) &&
        this.gitHeadWatchedTasks.has(entry.taskId)
      ) {
        void rpc.fs.watchStop(entry.projectId, entry.taskId, 'git-head', 'dirs');
        this.gitHeadWatchedTasks.delete(entry.taskId);
        this.maybeCleanupFsEventSub(entry.taskId);
      }
      this.maybeStopPoller(entry.taskId);
    }
    // buffer: no-op
  }

  private taskHasSubscribers(taskId: string): boolean {
    for (const [uri, entry] of this.modelMap) {
      if (entry.taskId === taskId && (this.subscriberCt.get(uri) ?? 0) > 0) return true;
    }
    return false;
  }

  private taskHasGitHeadSubscribers(taskId: string): boolean {
    for (const [gitUri, entry] of this.modelMap) {
      if (entry.type === 'git' && entry.taskId === taskId && entry.ref === 'HEAD') {
        if ((this.subscriberCt.get(gitUri) ?? 0) > 0) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Dedup fetch
  // ---------------------------------------------------------------------------

  private dedupFetch(key: string, fn: () => Promise<string | null>): Promise<string | null> {
    const existing = this.pendingFetches.get(key);
    if (existing) return existing;
    const p = fn().finally(() => this.pendingFetches.delete(key));
    this.pendingFetches.set(key, p);
    return p;
  }

  // ---------------------------------------------------------------------------
  // Register (public API)
  // ---------------------------------------------------------------------------

  /**
   * Register (or increment the reference count of) a model for `filePath`.
   *
   * - `'disk'`          — fetches disk content via RPC, creates `disk://` model.
   *                       FS watching is NOT started here; it starts only when a React
   *                       component subscribes via `subscribeToUri` (useModelStatus).
   * - `'gitBase'`/`'git'` — fetches git content via RPC; creates `git://` model.
   *                       .git dir watch starts only when subscribed to.
   * - `'buffer'`        — seeds from the existing disk model (disk must be registered first).
   *                       Creates `file://` model, fires any queued `onceBufferReady` callbacks.
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
    type: ModelType,
    ref = 'HEAD'
  ): Promise<string> {
    const uri = buildMonacoModelPath(modelRootPath, filePath);

    switch (type) {
      case 'disk':
        return this.registerDisk(projectId, taskId, uri, filePath, language);
      case 'gitBase':
      case 'git':
        return this.registerGit(projectId, taskId, uri, filePath, language, ref);
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
    const diskUri = this.toDiskUri(uri);
    const existing = this.modelMap.get(diskUri);

    if (existing?.type === 'disk') {
      existing.refs += 1;
      return uri;
    }

    // Mark as loading before the async RPC.
    this.modelStatus.set(diskUri, 'loading');
    this.notify(diskUri);

    let content: string;
    try {
      const fetchKey = `${projectId}:${taskId}:${filePath}:disk`;
      const result = await this.dedupFetch(fetchKey, async () => {
        const res = await rpc.fs.readFile(projectId, taskId, filePath);
        if (!res.success)
          throw new Error(`registerModel(disk): readFile failed for ${filePath}: ${res.error}`);
        return res.data.content;
      });
      if (result === null) throw new Error(`registerModel(disk): null content for ${filePath}`);
      content = result;
    } catch (err) {
      this.modelStatus.set(diskUri, 'error');
      this.notify(diskUri);
      throw err;
    }

    const m = this.getMonaco();
    if (m) {
      const diskMonacoUri = m.Uri.parse(diskUri);
      let model = m.editor.getModel(diskMonacoUri);
      if (!model) model = m.editor.createModel(content, language, diskMonacoUri);
      const entry: DiskModelEntry = {
        type: 'disk',
        model,
        refs: 1,
        projectId,
        taskId,
        filePath,
        language,
      };
      this.modelMap.set(diskUri, entry);
    }

    this.modelStatus.set(diskUri, 'ready');
    this.notify(diskUri);

    // If React components subscribed while model was loading, activate FS watching now.
    if ((this.subscriberCt.get(diskUri) ?? 0) > 0) {
      this.activateUriWatch(diskUri);
    }

    return uri;
  }

  private async registerGit(
    projectId: string,
    taskId: string,
    uri: string,
    filePath: string,
    language: string,
    ref: string
  ): Promise<string> {
    const gitUri = this.toGitUri(uri, ref);
    const existing = this.modelMap.get(gitUri);

    if (existing?.type === 'git') {
      existing.refs += 1;
      return uri;
    }

    this.modelStatus.set(gitUri, 'loading');
    this.notify(gitUri);

    const fetchKey = `${projectId}:${taskId}:${filePath}:git:${ref}`;
    const content = await this.dedupFetch(fetchKey, async () => {
      if (ref === 'staged') {
        const res = await rpc.git.getFileAtIndex(projectId, taskId, filePath);
        return res.success ? res.data.content : null;
      }
      const res = await rpc.git.getFileAtRef(projectId, taskId, filePath, ref);
      return res.success ? res.data.content : null;
    });

    const m = this.getMonaco();
    if (m) {
      const gitMonacoUri = m.Uri.parse(gitUri);
      let model = m.editor.getModel(gitMonacoUri);
      if (!model) model = m.editor.createModel(content ?? '', language, gitMonacoUri);
      const entry: GitModelEntry = {
        type: 'git',
        model,
        refs: 1,
        projectId,
        taskId,
        filePath,
        language,
        ref,
      };
      this.modelMap.set(gitUri, entry);
    }

    this.modelStatus.set(gitUri, 'ready');
    this.notify(gitUri);

    // If React components subscribed while model was loading, activate watching now.
    if ((this.subscriberCt.get(gitUri) ?? 0) > 0) {
      this.activateUriWatch(gitUri);
    }

    return uri;
  }

  private registerBuffer(uri: string, language: string): string {
    const existing = this.modelMap.get(uri);

    if (existing?.type === 'buffer') {
      existing.refs += 1;
      return uri;
    }

    const diskEntry = this.modelMap.get(this.toDiskUri(uri));
    const seedContent = diskEntry?.type === 'disk' ? diskEntry.model.getValue() : '';
    const projectId = diskEntry?.projectId ?? '';
    const taskId = diskEntry?.taskId ?? '';
    const filePath = diskEntry?.filePath ?? '';

    const m = this.getMonaco();
    if (m) {
      const bufferMonacoUri = m.Uri.parse(uri);
      let model = m.editor.getModel(bufferMonacoUri);
      if (!model) model = m.editor.createModel(seedContent, language, bufferMonacoUri);
      const entry: BufferModelEntry = {
        type: 'buffer',
        model,
        refs: 1,
        projectId,
        taskId,
        filePath,
        language,
        viewState: null,
      };
      this.modelMap.set(uri, entry);

      // Attach content-change listener for dirty tracking and crash-recovery autosave.
      const disposable = model.onDidChangeContent(() => {
        if (this.reloadingFromDisk.has(uri)) return;

        // Notify React subscribers so useIsDirty re-evaluates.
        this.notify(uri);

        // Debounced crash-recovery save — persists unsaved edits across app restarts.
        const existing = this.bufferAutosaveTimers.get(uri);
        if (existing) clearTimeout(existing);
        this.bufferAutosaveTimers.set(
          uri,
          setTimeout(() => {
            this.bufferAutosaveTimers.delete(uri);
            const currentEntry = this.modelMap.get(uri);
            if (!currentEntry || currentEntry.type !== 'buffer') return;
            if (!this.isDirty(uri)) return;
            const value = currentEntry.model.getValue();
            void rpc.editorBuffer.saveBuffer(
              currentEntry.projectId,
              currentEntry.taskId,
              currentEntry.filePath,
              value
            );
          }, BUFFER_DEBOUNCE_MS)
        );
      });
      this.bufferContentDisposables.set(uri, disposable);
    }

    this.modelStatus.set(uri, 'ready');
    this.notify(uri);

    const callbacks = this.bufferReadyCallbacks.get(uri);
    if (callbacks?.length) {
      callbacks.forEach((cb) => cb());
      this.bufferReadyCallbacks.delete(uri);
    }

    return uri;
  }

  // ---------------------------------------------------------------------------
  // Unregister (public API)
  // ---------------------------------------------------------------------------

  /**
   * Decrement the reference count for a model by its typed URI.
   * Disposes the Monaco model and cleans up subscriptions when count reaches 0.
   *
   * Pass the typed URI directly:
   *   buffer → the file:// buffer URI (same as returned by registerModel)
   *   disk   → toDiskUri(bufferUri)
   *   git    → toGitUri(bufferUri, ref)
   */
  unregisterModel(uri: string): void {
    // Cancel any pending TTL eviction — we're explicitly disposing.
    const timer = this.evictionTimers.get(uri);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.evictionTimers.delete(uri);
    }

    const entry = this.modelMap.get(uri);
    if (!entry) return;

    entry.refs -= 1;
    if (entry.refs > 0) return;

    if (!entry.model.isDisposed()) entry.model.dispose();
    this.modelMap.delete(uri);
    this.modelStatus.delete(uri);

    if (entry.type === 'disk') {
      // Remove from subscription group unconditionally (model is gone).
      this.diskSubscribedByTask.get(entry.taskId)?.delete(entry.filePath);
      const set = this.diskSubscribedByTask.get(entry.taskId);
      if (!set?.size) {
        this.diskSubscribedByTask.delete(entry.taskId);
        void rpc.fs.watchStop(entry.projectId, entry.taskId, 'disk', 'files');
      } else {
        this.syncDiskWatchedPaths(entry.projectId, entry.taskId);
      }
      this.maybeCleanupFsEventSub(entry.taskId);
    } else if (entry.type === 'git') {
      const remaining = this.gitEntriesForTask(entry.taskId);
      if (remaining.length === 0 && this.gitHeadWatchedTasks.has(entry.taskId)) {
        void rpc.fs.watchStop(entry.projectId, entry.taskId, 'git-head', 'dirs');
        this.gitHeadWatchedTasks.delete(entry.taskId);
        this.maybeCleanupFsEventSub(entry.taskId);
      }
    } else {
      // buffer
      this.bufferContentDisposables.get(uri)?.dispose();
      this.bufferContentDisposables.delete(uri);
      const autosaveTimer = this.bufferAutosaveTimers.get(uri);
      if (autosaveTimer !== undefined) {
        clearTimeout(autosaveTimer);
        this.bufferAutosaveTimers.delete(uri);
      }
      this.bufferReadyCallbacks.delete(uri);
      this.pendingConflicts.delete(uri);
      this.notify(uri);
    }

    this.maybeStopPoller(entry.taskId);
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
      const prev = this.modelMap.get(previousUri);
      if (prev?.type === 'buffer') prev.viewState = editor.saveViewState();
    }

    const entry = this.modelMap.get(newUri);
    if (entry?.type === 'buffer') {
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
    if (this.modelMap.has(uri)) {
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
    const buf = this.modelMap.get(uri);
    const disk = this.modelMap.get(this.toDiskUri(uri));
    if (!buf || buf.type !== 'buffer' || !disk || disk.type !== 'disk') return false;
    return buf.model.getValue() !== disk.model.getValue();
  }

  /**
   * Mark the current buffer content as saved.
   * Syncs the disk model to match the buffer so isDirty() returns false.
   */
  markSaved(uri: string): void {
    const buf = this.modelMap.get(uri);
    const disk = this.modelMap.get(this.toDiskUri(uri));
    if (buf?.type === 'buffer' && disk?.type === 'disk') {
      disk.model.setValue(buf.model.getValue());
      this.notify(uri);
    }
  }

  // ---------------------------------------------------------------------------
  // Content access
  // ---------------------------------------------------------------------------

  /**
   * Returns the ITextModel stored at the given typed URI, or undefined.
   * Use toDiskUri / toGitUri to construct typed URIs for disk/git entries.
   */
  getModelByUri(uri: string): monaco.editor.ITextModel | undefined {
    return this.modelMap.get(uri)?.model;
  }

  /** Current text content of the buffer model. */
  getValue(uri: string): string | null {
    const entry = this.modelMap.get(uri);
    return entry?.type === 'buffer' ? entry.model.getValue() : null;
  }

  /** Current text content of the disk model. */
  getDiskValue(uri: string): string | null {
    const entry = this.modelMap.get(this.toDiskUri(uri));
    return entry?.type === 'disk' ? entry.model.getValue() : null;
  }

  /** True if a buffer model is registered for this URI. */
  hasModel(uri: string): boolean {
    return this.modelMap.get(uri)?.type === 'buffer';
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
   * Sets reloadingFromDisk so the registry's onDidChangeContent listener
   * skips treating this as a user edit.
   */
  reloadFromDisk(uri: string): void {
    const buf = this.modelMap.get(uri);
    const disk = this.modelMap.get(this.toDiskUri(uri));
    if (buf?.type === 'buffer' && disk?.type === 'disk') {
      this.reloadingFromDisk.add(uri);
      buf.model.setValue(disk.model.getValue());
      this.reloadingFromDisk.delete(uri);
      this.notify(uri);
    }
    this.pendingConflicts.delete(uri);
  }

  /**
   * Write the buffer content to disk, sync the disk model, and clear the
   * crash-recovery buffer entry.
   *
   * @returns the saved content string on success, or `null` on failure.
   */
  async saveFileToDisk(uri: string): Promise<string | null> {
    const buf = this.modelMap.get(uri);
    if (!buf || buf.type !== 'buffer') return null;

    const content = buf.model.getValue();
    const result = await rpc.fs.writeFile(buf.projectId, buf.taskId, buf.filePath, content);
    if (!result.success) return null;

    this.markSaved(uri);
    this.pendingConflicts.delete(uri);
    void rpc.editorBuffer.clearBuffer(buf.projectId, buf.taskId, buf.filePath);
    return content;
  }

  // ---------------------------------------------------------------------------
  // Conflict state
  // ---------------------------------------------------------------------------

  hasPendingConflict(uri: string): boolean {
    return this.pendingConflicts.has(uri);
  }

  // ---------------------------------------------------------------------------
  // Manual invalidation
  // ---------------------------------------------------------------------------

  /**
   * Re-fetch the model at `uri` from its source (disk or git). No-op for buffers.
   * Bypasses dedup cache — always fires a fresh RPC.
   */
  async invalidateModel(uri: string): Promise<void> {
    const entry = this.modelMap.get(uri);
    if (!entry) return;
    if (entry.type === 'disk') {
      const res = await rpc.fs.readFile(entry.projectId, entry.taskId, entry.filePath);
      if (res.success) this.applyDiskUpdate(uri, entry, res.data.content);
    } else if (entry.type === 'git') {
      const res =
        entry.ref === 'staged'
          ? await rpc.git.getFileAtIndex(entry.projectId, entry.taskId, entry.filePath)
          : await rpc.git.getFileAtRef(entry.projectId, entry.taskId, entry.filePath, entry.ref);
      if (res.success && res.data.content !== null) {
        entry.model.setValue(res.data.content);
        this.notify(uri);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Git model refresh (triggered by .git dir watcher)
  // ---------------------------------------------------------------------------

  private async refreshGitModelsForTask(projectId: string, taskId: string): Promise<void> {
    const gitEntries = [...this.modelMap.entries()].filter(
      ([uri, e]) => e.type === 'git' && e.taskId === taskId && uri.startsWith('git://')
    ) as [string, GitModelEntry][];

    for (const [gitUri, entry] of gitEntries) {
      if (entry.ref !== 'HEAD') continue;
      const result = await rpc.git.getFileAtRef(projectId, taskId, entry.filePath, 'HEAD');
      if (!result.success || result.data.content === null) continue;
      if (entry.model.getValue() !== result.data.content) {
        entry.model.setValue(result.data.content);
        this.notify(gitUri);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Disk update helper (shared by handleFsEvents, pollTask, invalidateModel)
  // ---------------------------------------------------------------------------

  private applyDiskUpdate(diskUri: string, entry: DiskModelEntry, newContent: string): void {
    const bufferUri = diskUri.replace(/^disk:\/\//, 'file://');
    const wasDirty = this.isDirty(bufferUri);
    const bufEntry = this.modelMap.get(bufferUri);
    const bufValue = bufEntry?.type === 'buffer' ? bufEntry.model.getValue() : undefined;
    const newMatchesBuffer = bufValue === newContent;

    entry.model.setValue(newContent);
    this.notify(diskUri);

    if (!wasDirty || newMatchesBuffer) {
      // Only reload the buffer when content actually differs — skipping a no-op
      // setValue avoids the post-save FS-echo cursor reset.
      // applyEdits(ops, false) is used instead of setValue so that:
      //   1. Cursor, selection, and scroll position are preserved.
      //   2. The reload is invisible to Ctrl+Z (second arg suppresses undo tracking).
      if (bufEntry?.type === 'buffer' && !newMatchesBuffer) {
        this.reloadingFromDisk.add(bufferUri);
        const fullRange = bufEntry.model.getFullModelRange();
        bufEntry.model.applyEdits([{ range: fullRange, text: newContent }], false);
        this.reloadingFromDisk.delete(bufferUri);
        this.notify(bufferUri);
      }
    } else {
      this.pendingConflicts.add(bufferUri);
    }
  }

  // ---------------------------------------------------------------------------
  // File watcher sync
  // ---------------------------------------------------------------------------

  private syncDiskWatchedPaths(projectId: string, taskId: string): void {
    const paths = [...(this.diskSubscribedByTask.get(taskId) ?? [])];
    rpc.fs.watchSetPaths(projectId, taskId, paths, 'disk', 'files').catch(() => {});
  }

  private async handleFsEvents(taskId: string, fsEvents: FileWatchEvent[]): Promise<void> {
    // Route .git dir events → git model refresh.
    const hasGitEvent = fsEvents.some((e) => e.path.startsWith('.git'));
    if (hasGitEvent) {
      const gitEntry = [...this.modelMap.values()].find(
        (e): e is GitModelEntry => e.type === 'git' && e.taskId === taskId
      );
      if (gitEntry) void this.refreshGitModelsForTask(gitEntry.projectId, taskId);
    }

    // Process disk file modification events (skip .git paths).
    for (const event of fsEvents.filter((e) => e.type === 'modify' && !e.path.startsWith('.git'))) {
      const diskEntry = this.findDiskEntryByTaskAndPath(taskId, event.path);
      if (!diskEntry) continue;
      const { diskUri, entry } = diskEntry;
      const result = await rpc.fs.readFile(entry.projectId, taskId, event.path);
      if (!result.success) continue;
      this.applyDiskUpdate(diskUri, entry, result.data.content);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-task polling fallback (10 s)
  // ---------------------------------------------------------------------------

  private startPoller(projectId: string, taskId: string): void {
    if (this.taskPollers.has(taskId)) return;
    const id = setInterval(() => void this.pollTask(projectId, taskId), 10_000);
    this.taskPollers.set(taskId, id);
  }

  private maybeStopPoller(taskId: string): void {
    // Keep poller alive while any model for this task has subscribers.
    if (this.taskHasSubscribers(taskId)) return;
    const id = this.taskPollers.get(taskId);
    if (id !== undefined) {
      clearInterval(id);
      this.taskPollers.delete(taskId);
    }
  }

  private async pollTask(projectId: string, taskId: string): Promise<void> {
    for (const [uri, entry] of this.modelMap) {
      if (entry.taskId !== taskId) continue;
      if (entry.type === 'disk') {
        const res = await rpc.fs.readFile(projectId, taskId, entry.filePath);
        if (res.success && res.data.content !== entry.model.getValue()) {
          this.applyDiskUpdate(uri, entry, res.data.content);
        }
      } else if (entry.type === 'git') {
        // Skip polling staged/index content — it only changes through explicit staging operations,
        // not over time. Those paths invalidate models directly.
        if (entry.ref === 'staged') continue;
        const res = await rpc.git.getFileAtRef(projectId, taskId, entry.filePath, entry.ref);
        if (
          res.success &&
          res.data.content !== null &&
          res.data.content !== entry.model.getValue()
        ) {
          entry.model.setValue(res.data.content);
          this.notify(uri);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // FS event subscription management
  // ---------------------------------------------------------------------------

  private ensureFsEventSub(projectId: string, taskId: string): void {
    if (this.fsEventSubs.has(taskId)) return;
    const unsub = events.on(
      fsWatchEventChannel,
      (data) => void this.handleFsEvents(data.taskId, data.events),
      taskId
    );
    this.fsEventSubs.set(taskId, unsub);
  }

  private maybeCleanupFsEventSub(taskId: string): void {
    const hasDiskSub = (this.diskSubscribedByTask.get(taskId)?.size ?? 0) > 0;
    if (hasDiskSub) return;
    if (this.gitHeadWatchedTasks.has(taskId)) return;
    this.fsEventSubs.get(taskId)?.();
    this.fsEventSubs.delete(taskId);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private diskEntriesForTask(taskId: string): DiskModelEntry[] {
    const result: DiskModelEntry[] = [];
    for (const entry of this.modelMap.values()) {
      if (entry.type === 'disk' && entry.taskId === taskId) result.push(entry);
    }
    return result;
  }

  private gitEntriesForTask(taskId: string): GitModelEntry[] {
    const result: GitModelEntry[] = [];
    for (const entry of this.modelMap.values()) {
      if (entry.type === 'git' && entry.taskId === taskId) result.push(entry);
    }
    return result;
  }

  private findDiskEntryByTaskAndPath(
    taskId: string,
    filePath: string
  ): { diskUri: string; entry: DiskModelEntry } | undefined {
    for (const [diskUri, entry] of this.modelMap) {
      if (entry.type === 'disk' && entry.taskId === taskId && entry.filePath === filePath) {
        return { diskUri, entry };
      }
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

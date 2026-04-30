import { observable, runInAction } from 'mobx';
import type * as monaco from 'monaco-editor';
import { gitRefToString, HEAD_REF, refsEqual, type GitRef } from '@shared/git';
import { rpc } from '@renderer/lib/ipc';
import { buildMonacoModelPath } from './monacoModelPath';

const BUFFER_DEBOUNCE_MS = 2000;

// ---------------------------------------------------------------------------
// Discriminated-union entry types
// ---------------------------------------------------------------------------

interface BufferModelEntry {
  type: 'buffer';
  model: monaco.editor.ITextModel;
  /** Monaco cursor/scroll/folding state, saved between tab switches. */
  viewState: monaco.editor.ICodeEditorViewState | null;
  refs: number;
  projectId: string;
  workspaceId: string;
  filePath: string;
  language: string;
}

interface DiskModelEntry {
  type: 'disk';
  model: monaco.editor.ITextModel;
  refs: number;
  projectId: string;
  workspaceId: string;
  filePath: string;
  language: string;
}

interface GitModelEntry {
  type: 'git';
  model: monaco.editor.ITextModel;
  refs: number;
  projectId: string;
  workspaceId: string;
  filePath: string;
  language: string;
  /** The git ref — HEAD for the current commit; structured ref for PR/merge-target diffs. */
  ref: GitRef;
}

type ModelEntry = BufferModelEntry | DiskModelEntry | GitModelEntry;
export type ModelType = 'buffer' | 'disk' | 'git';
export type ModelStatus = 'loading' | 'ready' | 'error';

/**
 * Manages up to three Monaco ITextModel instances per open file using a single
 * unified map keyed by Monaco URI string.
 *
 *   buffer  (file://)  — writable; shown in the code editor; holds user edits + undo stack
 *   disk    (disk://)  — read-only mirror of the current on-disk content; updated by watcher
 *   git     (git://)   — read-only snapshot of a git ref (HEAD or arbitrary ref)
 *
 * ### Lifecycle
 *
 * **Registration** (`registerModel` / `unregisterModel`): ref-counted. Models are kept in memory
 * for 60 s after the last `unregisterModel` call, then evicted. Re-registering before the timer
 * fires cancels the eviction.
 *
 * **Invalidation**: the registry is a pure SWR cache — it does not subscribe to any events.
 * Callers must wire external invalidation bridges (see `invalidation-bridges.ts`) that translate
 * FS/git events into `invalidateModel(uri)` calls. Use `findGitUris` / `findDiskUris` to query
 * which URIs are affected by a given event.
 *
 * Binary files must be filtered by callers before registering (use `getFileKind` from fileKind.ts).
 */
export class MonacoModelRegistry {
  /**
   * Unified model map. Key is the Monaco URI string (scheme encodes entry type).
   *   file://  → BufferModelEntry
   *   disk://  → DiskModelEntry
   *   git://   → GitModelEntry
   *
   * Plain Map — Monaco ITextModel instances are imperative/mutable; not observable.
   */
  private modelMap = new Map<string, ModelEntry>();

  // ---------------------------------------------------------------------------
  // Monaco readiness — awaited before creating any ITextModel instance.
  // ---------------------------------------------------------------------------

  /**
   * Resolves with the Monaco namespace once a pool has finished initialization.
   * Both codeEditorPool and diffEditorPool call notifyMonacoReady() from their
   * onInit hooks, whichever resolves first wins (the promise is idempotent after
   * the first resolution).
   */
  private readonly monacoReadyPromise: Promise<typeof monaco>;
  private resolveMonacoReady!: (m: typeof monaco) => void;
  private monacoResolved = false;

  constructor() {
    this.monacoReadyPromise = new Promise<typeof monaco>((resolve) => {
      this.resolveMonacoReady = resolve;
    });
  }

  /**
   * Called by MonacoPool instances after Monaco finishes loading.
   * Safe to call multiple times — only the first call has any effect.
   */
  notifyMonacoReady(m: typeof monaco): void {
    if (this.monacoResolved) return;
    this.monacoResolved = true;
    this.resolveMonacoReady(m);
  }

  private reloadingFromDisk = new Set<string>();

  /**
   * URIs where the file was externally modified while the buffer had unsaved edits.
   * The conflict dialog is deferred until the user attempts to save the file.
   * Observable so future UI can react to conflict state if needed.
   */
  readonly pendingConflicts = observable.set<string>();

  private bufferReadyCallbacks = new Map<string, Array<() => void>>();

  /**
   * In-flight fetch deduplication. Prevents duplicate RPCs when two callers
   * register the same file concurrently before either resolves.
   * Key: `{projectId}:{workspaceId}:{filePath}:disk` or `…:git:{ref}`
   */
  private pendingFetches = new Map<string, Promise<string | null>>();

  // ---------------------------------------------------------------------------
  // MobX reactive state
  // ---------------------------------------------------------------------------

  /**
   * Model loading status — observable. Drives useModelStatus() in observer() components.
   */
  readonly modelStatus = observable.map<string, ModelStatus>();

  /**
   * Set of buffer URIs (file://) that have unsaved changes relative to disk.
   * Drives useIsDirty() in observer() components.
   */
  readonly dirtyUris = observable.set<string>();

  /**
   * Monotonically-increasing content version for each buffer URI (file://).
   * Incremented on every content change and set to 1 on initial buffer creation.
   * Observable so components that read buffer text (e.g. MarkdownEditorRenderer)
   * can subscribe reactively without polling — read this before calling getValue().
   */
  readonly bufferVersions = observable.map<string, number>();

  /**
   * Monotonically-increasing content version for each typed model URI.
   * Covers disk:// and git:// snapshots so non-Monaco renderers can react to
   * model invalidations without attaching an editor.
   */
  readonly modelVersions = observable.map<string, number>();

  /**
   * 60 s TTL timers. Started in unregisterModel when refs drop to 0.
   * Cancelled if the model is re-registered before the timer fires.
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
   * Example: file://workspace:abc/src/index.ts + HEAD_REF → git://workspace:abc/HEAD/src/index.ts
   */
  toGitUri(bufferUri: string, ref: GitRef): string {
    const refStr = gitRefToString(ref);
    const withoutScheme = bufferUri.replace(/^file:\/\//, '');
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx < 0) return bufferUri;
    const root = withoutScheme.slice(0, slashIdx);
    const filePath = withoutScheme.slice(slashIdx + 1);
    return `git://${root}/${encodeURIComponent(refStr)}/${filePath}`;
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
   * - `'disk'`   — fetches disk content via RPC, creates `disk://` model.
   * - `'git'`    — fetches git content via RPC; creates `git://` model.
   * - `'buffer'` — seeds from the existing disk model (disk must be registered first).
   *               Creates `file://` model, fires any queued `onceBufferReady` callbacks.
   *
   * Idempotent: if the model already exists, just increments ref count and returns the URI.
   *
   * @returns the buffer URI string (same for all three types of the same file)
   */
  async registerModel(
    projectId: string,
    workspaceId: string,
    modelRootPath: string,
    filePath: string,
    language: string,
    type: ModelType,
    ref: GitRef = HEAD_REF
  ): Promise<string> {
    const uri = buildMonacoModelPath(modelRootPath, filePath);

    switch (type) {
      case 'disk':
        return this.registerDisk(projectId, workspaceId, uri, filePath, language);
      case 'git':
        return this.registerGit(projectId, workspaceId, uri, filePath, language, ref);
      case 'buffer':
        return this.registerBuffer(uri, language);
    }
  }

  private async registerDisk(
    projectId: string,
    workspaceId: string,
    uri: string,
    filePath: string,
    language: string
  ): Promise<string> {
    const diskUri = this.toDiskUri(uri);
    const existing = this.modelMap.get(diskUri);

    if (existing?.type === 'disk') {
      existing.refs += 1;
      const timer = this.evictionTimers.get(diskUri);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.evictionTimers.delete(diskUri);
      }
      return uri;
    }

    this.modelStatus.set(diskUri, 'loading');

    // Run the RPC fetch and Monaco initialization in parallel — no need to wait
    // for Monaco before fetching file content from the main process.
    let content: string;
    let m: typeof monaco;
    try {
      const fetchKey = `${projectId}:${workspaceId}:${filePath}:disk`;
      [content, m] = await Promise.all([
        this.dedupFetch(fetchKey, async () => {
          const res = await rpc.fs.readFile(projectId, workspaceId, filePath);
          if (!res.success)
            throw new Error(`registerModel(disk): readFile failed for ${filePath}: ${res.error}`);
          const result = res.data.content;
          if (result === null) throw new Error(`registerModel(disk): null content for ${filePath}`);
          return result;
        }) as Promise<string>,
        this.monacoReadyPromise,
      ]);
    } catch (err) {
      this.modelStatus.set(diskUri, 'error');
      throw err;
    }

    const diskMonacoUri = m.Uri.parse(diskUri);
    let model = m.editor.getModel(diskMonacoUri);
    if (!model) model = m.editor.createModel(content, language, diskMonacoUri);
    const entry: DiskModelEntry = {
      type: 'disk',
      model,
      refs: 1,
      projectId,
      workspaceId,
      filePath,
      language,
    };
    this.modelMap.set(diskUri, entry);

    this.modelStatus.set(diskUri, 'ready');
    this.modelVersions.set(diskUri, 1);

    return uri;
  }

  private async registerGit(
    projectId: string,
    workspaceId: string,
    uri: string,
    filePath: string,
    language: string,
    ref: GitRef
  ): Promise<string> {
    const gitUri = this.toGitUri(uri, ref);
    const existing = this.modelMap.get(gitUri);

    if (existing?.type === 'git') {
      existing.refs += 1;
      const timer = this.evictionTimers.get(gitUri);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.evictionTimers.delete(gitUri);
      }
      return uri;
    }

    this.modelStatus.set(gitUri, 'loading');

    // Run the RPC fetch and Monaco initialization in parallel.
    const fetchKey = `${projectId}:${workspaceId}:${filePath}:git:${gitRefToString(ref)}`;
    const [content, m] = await Promise.all([
      this.dedupFetch(fetchKey, async () => {
        if (ref.kind === 'staged') {
          const res = await rpc.git.getFileAtIndex(projectId, workspaceId, filePath);
          return res.success ? res.data.content : null;
        }
        const res = await rpc.git.getFileAtRef(
          projectId,
          workspaceId,
          filePath,
          gitRefToString(ref)
        );
        return res.success ? res.data.content : null;
      }),
      this.monacoReadyPromise,
    ]);

    const gitMonacoUri = m.Uri.parse(gitUri);
    let model = m.editor.getModel(gitMonacoUri);
    if (!model) model = m.editor.createModel(content ?? '', language, gitMonacoUri);
    const entry: GitModelEntry = {
      type: 'git',
      model,
      refs: 1,
      projectId,
      workspaceId,
      filePath,
      language,
      ref,
    };
    this.modelMap.set(gitUri, entry);

    this.modelStatus.set(gitUri, 'ready');
    this.modelVersions.set(gitUri, 1);

    return uri;
  }

  private async registerBuffer(uri: string, language: string): Promise<string> {
    const existing = this.modelMap.get(uri);

    if (existing?.type === 'buffer') {
      existing.refs += 1;
      const timer = this.evictionTimers.get(uri);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.evictionTimers.delete(uri);
      }
      // Re-attach the content-change listener if it was eagerly disposed when
      // refs previously dropped to 0 (tab close), but the model survived the
      // 60 s eviction window and is now being re-registered.
      if (!this.bufferContentDisposables.has(uri)) {
        const disposable = existing.model.onDidChangeContent(() => {
          if (this.reloadingFromDisk.has(uri)) return;
          runInAction(() => {
            if (this.computeIsDirtyRaw(uri)) this.dirtyUris.add(uri);
            else this.dirtyUris.delete(uri);
            this.bufferVersions.set(uri, (this.bufferVersions.get(uri) ?? 0) + 1);
          });
          const existingTimer = this.bufferAutosaveTimers.get(uri);
          if (existingTimer) clearTimeout(existingTimer);
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
                currentEntry.workspaceId,
                currentEntry.filePath,
                value
              );
            }, BUFFER_DEBOUNCE_MS)
          );
        });
        this.bufferContentDisposables.set(uri, disposable);
      }
      return uri;
    }

    const m = await this.monacoReadyPromise;

    const diskEntry = this.modelMap.get(this.toDiskUri(uri));
    const seedContent = diskEntry?.type === 'disk' ? diskEntry.model.getValue() : '';
    const projectId = diskEntry?.projectId ?? '';
    const workspaceId = diskEntry?.workspaceId ?? '';
    const filePath = diskEntry?.filePath ?? '';

    {
      const bufferMonacoUri = m.Uri.parse(uri);
      let model = m.editor.getModel(bufferMonacoUri);
      if (!model) model = m.editor.createModel(seedContent, language, bufferMonacoUri);
      const entry: BufferModelEntry = {
        type: 'buffer',
        model,
        refs: 1,
        projectId,
        workspaceId,
        filePath,
        language,
        viewState: null,
      };
      this.modelMap.set(uri, entry);

      // Attach content-change listener for dirty tracking and crash-recovery autosave.
      const disposable = model.onDidChangeContent(() => {
        if (this.reloadingFromDisk.has(uri)) return;

        // Update reactive dirty set and bump content version so observer()
        // components that render buffer text (e.g. markdown preview) re-render.
        runInAction(() => {
          if (this.computeIsDirtyRaw(uri)) this.dirtyUris.add(uri);
          else this.dirtyUris.delete(uri);
          this.bufferVersions.set(uri, (this.bufferVersions.get(uri) ?? 0) + 1);
        });

        // Debounced crash-recovery save — persists unsaved edits across app restarts.
        const existingTimer = this.bufferAutosaveTimers.get(uri);
        if (existingTimer) clearTimeout(existingTimer);
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
              currentEntry.workspaceId,
              currentEntry.filePath,
              value
            );
          }, BUFFER_DEBOUNCE_MS)
        );
      });
      this.bufferContentDisposables.set(uri, disposable);
    }

    this.modelStatus.set(uri, 'ready');
    this.modelVersions.set(uri, 1);
    // Mark the buffer as having content so markdown/other renderers that depend
    // on bufferVersions can react to the initial population.
    runInAction(() => {
      this.bufferVersions.set(uri, 1);
    });

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
    const entry = this.modelMap.get(uri);
    if (!entry) return;

    entry.refs -= 1;
    if (entry.refs > 0) return;

    // refs === 0 — start 60 s cleanup timer. If the model is re-registered before
    // the timer fires, the timer is cancelled in the register* methods above.
    const t = setTimeout(() => {
      this.evictionTimers.delete(uri);
      const e = this.modelMap.get(uri);
      if (!e || e.refs > 0) return;
      if (!e.model.isDisposed()) e.model.dispose();
      this.modelMap.delete(uri);
      this.modelStatus.delete(uri);
      this.modelVersions.delete(uri);
      if (e.type === 'buffer') {
        this.bufferContentDisposables.get(uri)?.dispose();
        this.bufferContentDisposables.delete(uri);
        const autosaveTimer = this.bufferAutosaveTimers.get(uri);
        if (autosaveTimer !== undefined) {
          clearTimeout(autosaveTimer);
          this.bufferAutosaveTimers.delete(uri);
        }
        this.bufferReadyCallbacks.delete(uri);
        this.pendingConflicts.delete(uri);
        runInAction(() => {
          this.dirtyUris.delete(uri);
          this.bufferVersions.delete(uri);
        });
      }
    }, 60_000);
    this.evictionTimers.set(uri, t);

    // Eagerly clean up buffer-specific in-memory state immediately (content disposables,
    // autosave timers) so that edits made in a closing tab don't fire after close.
    if (entry.type === 'buffer') {
      this.bufferContentDisposables.get(uri)?.dispose();
      this.bufferContentDisposables.delete(uri);
      const autosaveTimer = this.bufferAutosaveTimers.get(uri);
      if (autosaveTimer !== undefined) {
        clearTimeout(autosaveTimer);
        this.bufferAutosaveTimers.delete(uri);
      }
    }
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
    return this.dirtyUris.has(uri);
  }

  /** Computes actual dirty state by comparing model values. Used internally to populate dirtyUris. */
  private computeIsDirtyRaw(uri: string): boolean {
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
      runInAction(() => {
        this.dirtyUris.delete(uri);
      });
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
  // Conflict state
  // ---------------------------------------------------------------------------

  hasPendingConflict(uri: string): boolean {
    return this.pendingConflicts.has(uri);
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
      runInAction(() => {
        this.dirtyUris.delete(uri);
      });
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
    const result = await rpc.fs.writeFile(buf.projectId, buf.workspaceId, buf.filePath, content);
    if (!result.success) return null;

    this.markSaved(uri);
    this.pendingConflicts.delete(uri);
    void rpc.editorBuffer.clearBuffer(buf.projectId, buf.workspaceId, buf.filePath);
    return content;
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
      const res = await rpc.fs.readFile(entry.projectId, entry.workspaceId, entry.filePath);
      if (res.success) this.applyDiskUpdate(uri, entry, res.data.content);
    } else if (entry.type === 'git') {
      const res =
        entry.ref.kind === 'staged'
          ? await rpc.git.getFileAtIndex(entry.projectId, entry.workspaceId, entry.filePath)
          : await rpc.git.getFileAtRef(
              entry.projectId,
              entry.workspaceId,
              entry.filePath,
              gitRefToString(entry.ref)
            );
      if (res.success && res.data.content !== null) {
        entry.model.setValue(res.data.content);
        this.modelVersions.set(uri, (this.modelVersions.get(uri) ?? 0) + 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Query methods — used by invalidation bridges to find affected URIs
  // ---------------------------------------------------------------------------

  /**
   * Return all registered git:// URIs matching the given filter.
   * Used by invalidation bridges to find which models to invalidate after an event.
   * Any filter field left undefined is treated as a wildcard.
   */
  findGitUris(filter: {
    workspaceId?: string;
    projectId?: string;
    ref?: GitRef;
    refKind?: GitRef['kind'];
  }): string[] {
    const result: string[] = [];
    for (const [uri, entry] of this.modelMap) {
      if (entry.type !== 'git') continue;
      if (filter.workspaceId !== undefined && entry.workspaceId !== filter.workspaceId) continue;
      if (filter.projectId !== undefined && entry.projectId !== filter.projectId) continue;
      if (filter.refKind !== undefined && entry.ref.kind !== filter.refKind) continue;
      if (filter.ref !== undefined && !refsEqual(filter.ref, entry.ref)) continue;
      result.push(uri);
    }
    return result;
  }

  /**
   * Return all registered disk:// URIs for the given workspace and file path.
   * Used by the FS-event invalidation bridge.
   */
  findDiskUris(filter: { workspaceId: string; filePath: string }): string[] {
    const result: string[] = [];
    for (const [uri, entry] of this.modelMap) {
      if (entry.type !== 'disk') continue;
      if (entry.workspaceId !== filter.workspaceId) continue;
      if (entry.filePath !== filter.filePath) continue;
      result.push(uri);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Disk update helper (used by invalidateModel)
  // ---------------------------------------------------------------------------

  private applyDiskUpdate(diskUri: string, entry: DiskModelEntry, newContent: string): void {
    const bufferUri = diskUri.replace(/^disk:\/\//, 'file://');
    const bufEntry = this.modelMap.get(bufferUri);
    const bufValue = bufEntry?.type === 'buffer' ? bufEntry.model.getValue() : undefined;
    const wasDirty = this.dirtyUris.has(bufferUri);
    const newMatchesBuffer = bufValue === newContent;

    entry.model.setValue(newContent);
    this.modelVersions.set(diskUri, (this.modelVersions.get(diskUri) ?? 0) + 1);

    if (!wasDirty || newMatchesBuffer) {
      if (bufEntry?.type === 'buffer' && !newMatchesBuffer) {
        this.reloadingFromDisk.add(bufferUri);
        const fullRange = bufEntry.model.getFullModelRange();
        bufEntry.model.applyEdits([{ range: fullRange, text: newContent }], false);
        this.reloadingFromDisk.delete(bufferUri);
      }
      // Clear dirty state — disk now matches buffer (either buffer was synced to disk, or
      // new disk content already matched existing buffer edits).
      runInAction(() => {
        this.dirtyUris.delete(bufferUri);
      });
    } else {
      this.pendingConflicts.add(bufferUri);
    }
  }
}

export const modelRegistry = new MonacoModelRegistry();

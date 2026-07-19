import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import { filesContract, type FileContentModel } from '@emdash/core/runtimes/files/api';
import {
  gitContract,
  type GitFileContentState,
  type GitFileSource,
} from '@emdash/core/runtimes/git/api';
import { createLiveModelReplica, type LiveModelReplica, type ReplicaInstance } from '@emdash/wire';
import { observable, runInAction } from 'mobx';
import type * as monaco from 'monaco-editor';
import { hostPathFromNative, relativeRuntimePath } from '@core/primitives/desktop-runtime/api';
import { HEAD_REF, type GitRef } from '@core/primitives/git/api';
import { gitRefToString } from '@core/primitives/git/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { getFilesRuntimeClient } from '@renderer/lib/runtime/files-client';
import { getGitRuntimeClient } from '@renderer/lib/runtime/git-client';
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
  /** Etag of the disk content this buffer was last synchronized with. */
  baseEtag: string | undefined;
}

interface DiskModelEntry {
  type: 'disk';
  model: monaco.editor.ITextModel;
  refs: number;
  projectId: string;
  workspaceId: string;
  filePath: string;
  language: string;
  content: ReplicaInstance<FilesContentModel>;
  releaseContent: () => Promise<void>;
  unsubscribeContent: () => void;
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
  releaseContent: () => Promise<void>;
  unsubscribeContent: () => void;
}

type ModelEntry = BufferModelEntry | DiskModelEntry | GitModelEntry;
export type ModelType = 'buffer' | 'disk' | 'git';
export type ModelStatus = 'loading' | 'ready' | 'error' | 'too-large';

type FilesContentModel = typeof filesContract.content;
type GitContentModel = typeof gitContract.checkout.content;

type WorkspaceRoot = {
  projectId: string;
  path: string;
  root: HostAbsolutePath;
};

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
 * **Source synchronization**: disk and Git models lease Wire live models for as long as the
 * Monaco model is retained. Files content updates clean buffers directly; dirty buffers are
 * preserved and marked conflicted. Git content updates its read-only Monaco model directly.
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

  /** Local runtime roots supplied by WorkspaceStore; Monaco URI roots are not filesystem paths. */
  private workspaceRoots = new Map<string, WorkspaceRoot>();

  private filesContentReplicaPromise: Promise<LiveModelReplica<FilesContentModel>> | null = null;
  private gitContentReplicaPromise: Promise<LiveModelReplica<GitContentModel>> | null = null;

  /**
   * Diff editor view states keyed by `${originalUri}::${modifiedUri}`.
   * Saves and restores scroll/cursor for the Monaco diff editor across tab switches,
   * mirroring how BufferModelEntry.viewState works for regular file tabs.
   * Entries are swept out when either constituent model is evicted (see unregisterModel).
   */
  private diffViewStates = new Map<string, monaco.editor.IDiffEditorViewState>();

  // ---------------------------------------------------------------------------
  // Monaco readiness — awaited before creating any ITextModel instance.
  // ---------------------------------------------------------------------------

  /**
   * Resolves once monacoBootstrap.init() completes.
   * notifyMonacoReady() is called by the bootstrap; the promise is idempotent
   * after the first resolution.
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
   * Called by monacoBootstrap after Monaco finishes loading.
   * Safe to call multiple times — only the first call has any effect.
   */
  notifyMonacoReady(m: typeof monaco): void {
    if (this.monacoResolved) return;
    this.monacoResolved = true;
    this.resolveMonacoReady(m);
  }

  bindWorkspaceRoot(projectId: string, workspaceId: string, path: string): void {
    this.workspaceRoots.set(workspaceId, {
      projectId,
      path,
      root: hostPathFromNative(path),
    });
  }

  unbindWorkspaceRoot(projectId: string, workspaceId: string): void {
    const root = this.workspaceRoots.get(workspaceId);
    if (root?.projectId === projectId) this.workspaceRoots.delete(workspaceId);
  }

  private reloadingFromDisk = new Set<string>();

  /**
   * URIs where the file was externally modified while the buffer had unsaved edits.
   * The conflict dialog is deferred until the user attempts to save the file.
   * Observable so future UI can react to conflict state if needed.
   */
  readonly pendingConflicts = observable.set<string>();

  private bufferReadyCallbacks = new Map<string, Array<() => void>>();

  // ---------------------------------------------------------------------------
  // MobX reactive state
  // ---------------------------------------------------------------------------

  /**
   * Model loading status — observable. Drives useModelStatus() in observer() components.
   */
  readonly modelStatus = observable.map<string, ModelStatus>();

  /**
   * Total file size in bytes for disk:// URIs where the file was too large to load into Monaco.
   * Keyed by disk:// URI. Used to display file size in the tab bar tooltip and TooLargeRenderer.
   */
  readonly modelTotalSizes = observable.map<string, number>();

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
    const key = this.runtimePath(projectId, workspaceId, filePath);
    const replica = await this.getFilesContentReplica();
    const lease = replica.acquire(key);
    let contentModel: ReplicaInstance<FilesContentModel>;
    try {
      contentModel = await lease.ready();
    } catch (err) {
      await lease.release();
      this.modelStatus.set(diskUri, 'error');
      throw err;
    }

    const content = contentModel.states.content.current();
    if (content.kind === 'unavailable') {
      await lease.release();
      this.modelStatus.set(diskUri, 'error');
      throw new Error(
        `registerModel(disk): content unavailable for ${filePath}: ${JSON.stringify(content.error)}`
      );
    }
    if (content.kind === 'binary') {
      await lease.release();
      this.modelStatus.set(diskUri, 'error');
      throw new Error(`registerModel(disk): binary content for ${filePath}`);
    }
    if (content.truncated) {
      await lease.release();
      runInAction(() => {
        this.modelStatus.set(diskUri, 'too-large');
        this.modelTotalSizes.set(diskUri, content.byteSize);
      });
      return uri;
    }

    const m = await this.monacoReadyPromise;

    const diskMonacoUri = m.Uri.parse(diskUri);
    let model = m.editor.getModel(diskMonacoUri);
    if (!model) model = m.editor.createModel(content.content, language, diskMonacoUri);
    const entry: DiskModelEntry = {
      type: 'disk',
      model,
      refs: 1,
      projectId,
      workspaceId,
      filePath,
      language,
      content: contentModel,
      releaseContent: () => lease.release(),
      unsubscribeContent: () => {},
    };
    this.modelMap.set(diskUri, entry);
    entry.unsubscribeContent = contentModel.states.content.onChange((value) => {
      const current = this.modelMap.get(diskUri);
      if (current?.type === 'disk') this.applyDiskUpdate(diskUri, current, value);
    });

    this.modelStatus.set(diskUri, 'ready');

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
    const path = this.runtimePath(projectId, workspaceId, filePath);
    const replica = await this.getGitContentReplica();
    const lease = replica.acquire({
      checkout: path.root,
      path: path.relative,
      source: this.gitSource(ref),
    });
    let contentModel: ReplicaInstance<GitContentModel>;
    try {
      contentModel = await lease.ready();
    } catch (error) {
      await lease.release();
      this.modelStatus.set(gitUri, 'error');
      throw error;
    }
    const content = contentModel.states.content.current();
    if (content.kind === 'unavailable') {
      await lease.release();
      this.modelStatus.set(gitUri, 'error');
      throw new Error(
        `registerModel(git): content unavailable for ${filePath}: ${JSON.stringify(content.error)}`
      );
    }
    const m = await this.monacoReadyPromise;

    const gitMonacoUri = m.Uri.parse(gitUri);
    let model = m.editor.getModel(gitMonacoUri);
    if (!model) model = m.editor.createModel(this.gitContentText(content), language, gitMonacoUri);
    const entry: GitModelEntry = {
      type: 'git',
      model,
      refs: 1,
      projectId,
      workspaceId,
      filePath,
      language,
      ref,
      releaseContent: () => lease.release(),
      unsubscribeContent: () => {},
    };
    this.modelMap.set(gitUri, entry);
    entry.unsubscribeContent = contentModel.states.content.onChange((value) => {
      const current = this.modelMap.get(gitUri);
      if (current?.type !== 'git') return;
      if (value.kind === 'unavailable') {
        this.modelStatus.set(gitUri, 'error');
        return;
      }
      current.model.setValue(this.gitContentText(value));
      this.modelStatus.set(gitUri, 'ready');
    });

    this.modelStatus.set(gitUri, 'ready');

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
          this.reconcileBufferDirtyState(uri);
          runInAction(() => {
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
              void getDesktopWireClient().then((client) =>
                client.editor.saveBuffer({
                  projectId: currentEntry.projectId,
                  workspaceId: currentEntry.workspaceId,
                  filePath: currentEntry.filePath,
                  content: value,
                })
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
        baseEtag: this.diskEtag(diskEntry),
      };
      this.modelMap.set(uri, entry);

      // Attach content-change listener for dirty tracking and crash-recovery autosave.
      const disposable = model.onDidChangeContent(() => {
        if (this.reloadingFromDisk.has(uri)) return;

        // Update reactive dirty set and bump content version so observer()
        // components that render buffer text (e.g. markdown preview) re-render.
        this.reconcileBufferDirtyState(uri);
        runInAction(() => {
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
            void getDesktopWireClient().then((client) =>
              client.editor.saveBuffer({
                projectId: currentEntry.projectId,
                workspaceId: currentEntry.workspaceId,
                filePath: currentEntry.filePath,
                content: value,
              })
            );
          }, BUFFER_DEBOUNCE_MS)
        );
      });
      this.bufferContentDisposables.set(uri, disposable);
    }

    this.modelStatus.set(uri, 'ready');
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
    if (!entry) {
      // No Monaco model was created — this can happen for too-large disk models.
      // Clean up status and size immediately since there is nothing else to evict.
      if (this.modelStatus.get(uri) === 'too-large') {
        runInAction(() => {
          this.modelStatus.delete(uri);
          this.modelTotalSizes.delete(uri);
        });
      }
      return;
    }

    entry.refs -= 1;
    if (entry.refs > 0) return;

    // refs === 0 — start 60 s cleanup timer. If the model is re-registered before
    // the timer fires, the timer is cancelled in the register* methods above.
    const t = setTimeout(() => {
      this.evictionTimers.delete(uri);
      const e = this.modelMap.get(uri);
      if (!e || e.refs > 0) return;
      if (e.type === 'disk' || e.type === 'git') {
        e.unsubscribeContent();
        void e.releaseContent();
      }
      if (!e.model.isDisposed()) e.model.dispose();
      this.modelMap.delete(uri);
      this.modelStatus.delete(uri);
      if (e.type === 'disk') this.modelTotalSizes.delete(uri);
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
      // Sweep any diff view states that referenced this model.
      for (const key of this.diffViewStates.keys()) {
        if (key.startsWith(uri + '::') || key.endsWith('::' + uri)) {
          this.diffViewStates.delete(key);
        }
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

  async dispose(): Promise<void> {
    for (const timer of this.evictionTimers.values()) clearTimeout(timer);
    for (const timer of this.bufferAutosaveTimers.values()) clearTimeout(timer);
    this.evictionTimers.clear();
    this.bufferAutosaveTimers.clear();
    for (const disposable of this.bufferContentDisposables.values()) disposable.dispose();
    this.bufferContentDisposables.clear();

    const releases: Promise<void>[] = [];
    for (const entry of this.modelMap.values()) {
      if (entry.type === 'disk' || entry.type === 'git') {
        entry.unsubscribeContent();
        releases.push(entry.releaseContent());
      }
      if (!entry.model.isDisposed()) entry.model.dispose();
    }
    this.modelMap.clear();
    await Promise.all(releases);

    const filesReplica = this.filesContentReplicaPromise;
    const gitReplica = this.gitContentReplicaPromise;
    this.filesContentReplicaPromise = null;
    this.gitContentReplicaPromise = null;
    await Promise.all([
      filesReplica?.then((replica) => replica.dispose()),
      gitReplica?.then((replica) => replica.dispose()),
    ]);
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

  detach(editor: monaco.editor.IStandaloneCodeEditor, previousUri?: string): void {
    if (previousUri) {
      const prev = this.modelMap.get(previousUri);
      if (prev?.type === 'buffer') prev.viewState = editor.saveViewState();
    }
    editor.setModel(null);
  }

  // ---------------------------------------------------------------------------
  // Diff view state — scroll/cursor preservation across diff tab switches
  // ---------------------------------------------------------------------------

  private diffKey(originalUri: string, modifiedUri: string): string {
    return `${originalUri}::${modifiedUri}`;
  }

  /**
   * Save the diff editor's current viewport state (scroll + cursor) for the given
   * model pair. Call this before swapping models (i.e. in the effect cleanup).
   */
  saveDiffViewState(
    originalUri: string,
    modifiedUri: string,
    editor: monaco.editor.IStandaloneDiffEditor
  ): void {
    const vs = editor.saveViewState();
    if (vs) this.diffViewStates.set(this.diffKey(originalUri, modifiedUri), vs);
  }

  /**
   * Restore a previously saved diff editor viewport state.
   * Call this after editor.setModel() so the editor has a layout target.
   * No-ops silently if no state was ever saved for this pair.
   */
  restoreDiffViewState(
    originalUri: string,
    modifiedUri: string,
    editor: monaco.editor.IStandaloneDiffEditor
  ): void {
    const vs = this.diffViewStates.get(this.diffKey(originalUri, modifiedUri));
    if (vs) editor.restoreViewState(vs);
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

  async saveAllDirtyBuffers(): Promise<boolean> {
    for (const uri of [...this.dirtyUris]) {
      if ((await this.saveFileToDisk(uri)) === null) return false;
    }
    return this.dirtyUris.size === 0;
  }

  async discardAllDirtyBuffers(): Promise<void> {
    const client = await getDesktopWireClient();
    const entries = [...this.dirtyUris].flatMap((uri) => {
      const entry = this.modelMap.get(uri);
      return entry?.type === 'buffer' ? [{ uri, entry }] : [];
    });
    for (const { uri } of entries) {
      const timer = this.bufferAutosaveTimers.get(uri);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.bufferAutosaveTimers.delete(uri);
      }
    }
    try {
      await Promise.all(
        entries.map(({ entry }) =>
          client.editor.clearBuffer({
            projectId: entry.projectId,
            workspaceId: entry.workspaceId,
            filePath: entry.filePath,
          })
        )
      );
    } catch (error) {
      await Promise.allSettled(
        entries.map(({ entry }) =>
          client.editor.saveBuffer({
            projectId: entry.projectId,
            workspaceId: entry.workspaceId,
            filePath: entry.filePath,
            content: entry.model.getValue(),
          })
        )
      );
      throw error;
    }
    for (const { uri } of entries) this.reloadFromDisk(uri);
  }

  /** Computes actual dirty state by comparing model values. Used internally to populate dirtyUris. */
  private computeIsDirtyRaw(uri: string): boolean {
    const buf = this.modelMap.get(uri);
    const disk = this.modelMap.get(this.toDiskUri(uri));
    if (!buf || buf.type !== 'buffer' || !disk || disk.type !== 'disk') return false;
    return buf.model.getValue() !== disk.model.getValue();
  }

  private reconcileBufferDirtyState(uri: string): void {
    const dirty = this.computeIsDirtyRaw(uri);
    const buffer = this.modelMap.get(uri);
    const disk = this.modelMap.get(this.toDiskUri(uri));
    if (!dirty && buffer?.type === 'buffer') buffer.baseEtag = this.diskEtag(disk);
    runInAction(() => {
      if (dirty) {
        this.dirtyUris.add(uri);
      } else {
        this.dirtyUris.delete(uri);
        this.pendingConflicts.delete(uri);
      }
    });
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
      buf.baseEtag = this.diskEtag(disk);
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

  filePathForUri(uri: string): string | undefined {
    return this.modelMap.get(uri)?.filePath;
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
      buf.baseEtag = this.diskEtag(disk);
      runInAction(() => {
        this.dirtyUris.delete(uri);
        this.bufferVersions.set(uri, (this.bufferVersions.get(uri) ?? 0) + 1);
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
  async saveFileToDisk(uri: string, options: { overwrite?: boolean } = {}): Promise<string | null> {
    const buf = this.modelMap.get(uri);
    if (!buf || buf.type !== 'buffer') return null;
    const disk = this.modelMap.get(this.toDiskUri(uri));
    if (!disk || disk.type !== 'disk') return null;

    const content = buf.model.getValue();
    const precondition = options.overwrite
      ? ({ kind: 'overwrite' } as const)
      : buf.baseEtag
        ? ({ kind: 'etag', etag: buf.baseEtag } as const)
        : null;
    if (!precondition) return null;

    const invocation = await disk.content.mutations.write({ content, precondition });
    if (!invocation.result.success) {
      if (invocation.result.error.type === 'etag-mismatch') {
        this.pendingConflicts.add(uri);
        await disk.content.states.content.refresh();
      }
      return null;
    }
    await invocation.settled;

    this.markSaved(uri);
    this.pendingConflicts.delete(uri);
    const client = await getDesktopWireClient();
    await client.editor.clearBuffer({
      projectId: buf.projectId,
      workspaceId: buf.workspaceId,
      filePath: buf.filePath,
    });
    return content;
  }

  // ---------------------------------------------------------------------------
  // Runtime bindings
  // ---------------------------------------------------------------------------

  private async getFilesContentReplica(): Promise<LiveModelReplica<FilesContentModel>> {
    this.filesContentReplicaPromise ??= getFilesRuntimeClient().then((client) =>
      createLiveModelReplica(filesContract.content, client.content)
    );
    return this.filesContentReplicaPromise;
  }

  private async getGitContentReplica(): Promise<LiveModelReplica<GitContentModel>> {
    this.gitContentReplicaPromise ??= getGitRuntimeClient().then((client) =>
      createLiveModelReplica(gitContract.checkout.content, client.checkout.content)
    );
    return this.gitContentReplicaPromise;
  }

  private runtimePath(
    projectId: string,
    workspaceId: string,
    filePath: string
  ): { root: HostAbsolutePath; relative: PortableRelativePath } {
    const workspace = this.workspaceRoots.get(workspaceId);
    if (!workspace || workspace.projectId !== projectId) {
      throw new Error(`No local runtime root is bound for workspace ${workspaceId}`);
    }
    return {
      root: workspace.root,
      relative: relativeRuntimePath(workspace.root, filePath),
    };
  }

  private gitSource(ref: GitRef): GitFileSource {
    if (ref.kind === 'head') return { kind: 'head' };
    if (ref.kind === 'staged') return { kind: 'index' };
    if (ref.kind === 'unstaged') {
      throw new Error('Working-tree content must be read through the Files runtime');
    }
    return { kind: 'revision', revision: ref };
  }

  private gitContentText(content: GitFileContentState): string {
    return content.kind === 'text' ? content.content : '';
  }

  private diskEtag(entry: ModelEntry | undefined): string | undefined {
    if (entry?.type !== 'disk') return undefined;
    const content = entry.content.states.content.current();
    return content.kind === 'text' ? content.etag : undefined;
  }

  private applyDiskUpdate(diskUri: string, entry: DiskModelEntry, content: FileContentModel): void {
    const bufferUri = diskUri.replace(/^disk:\/\//, 'file://');
    const bufEntry = this.modelMap.get(bufferUri);
    if (content.kind === 'unavailable' || content.kind === 'binary') {
      this.modelStatus.set(diskUri, 'error');
      if (bufEntry?.type === 'buffer' && this.dirtyUris.has(bufferUri)) {
        this.pendingConflicts.add(bufferUri);
      }
      return;
    }
    if (content.truncated) {
      runInAction(() => {
        this.modelStatus.set(diskUri, 'too-large');
        this.modelTotalSizes.set(diskUri, content.byteSize);
      });
      if (bufEntry?.type === 'buffer') this.pendingConflicts.add(bufferUri);
      return;
    }

    const newContent = content.content;
    const bufValue = bufEntry?.type === 'buffer' ? bufEntry.model.getValue() : undefined;
    const wasDirty = this.dirtyUris.has(bufferUri);
    const newMatchesBuffer = bufValue === newContent;

    entry.model.setValue(newContent);
    runInAction(() => {
      this.modelStatus.set(diskUri, 'ready');
      this.modelTotalSizes.delete(diskUri);
    });

    if (!wasDirty || newMatchesBuffer) {
      if (bufEntry?.type === 'buffer' && !newMatchesBuffer) {
        this.reloadingFromDisk.add(bufferUri);
        const fullRange = bufEntry.model.getFullModelRange();
        bufEntry.model.applyEdits([{ range: fullRange, text: newContent }], false);
        this.reloadingFromDisk.delete(bufferUri);
        runInAction(() => {
          this.bufferVersions.set(bufferUri, (this.bufferVersions.get(bufferUri) ?? 0) + 1);
        });
      }
      if (bufEntry?.type === 'buffer') bufEntry.baseEtag = content.etag;
      // Clear dirty state — disk now matches buffer (either buffer was synced to disk, or
      // new disk content already matched existing buffer edits).
      runInAction(() => {
        this.dirtyUris.delete(bufferUri);
      });
      this.pendingConflicts.delete(bufferUri);
    } else {
      this.pendingConflicts.add(bufferUri);
    }
  }
}

export const modelRegistry = new MonacoModelRegistry();

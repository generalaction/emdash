import { makeAutoObservable, observable, runInAction } from 'mobx';
import { HEAD_REF } from '@shared/git';
import type { EditorViewSnapshot } from '@shared/view-state';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import { getMonacoLanguageId } from '@renderer/utils/diffUtils';
import { log } from '@renderer/utils/logger';

/**
 * Pure Monaco model lifecycle manager. Owns no tab state — that lives in TabManagerStore.
 *
 * Responsibilities:
 *   - Register/unregister Monaco models (disk, git, buffer) for open files
 *   - Save files to disk and handle conflict resolution
 *   - Track file-tree sidebar expanded paths
 *
 * `registerModels` / `unregisterModels` are called by the reactive model-lifecycle
 * reaction in TaskViewStore, keyed off `TabManagerStore.openFilePaths`.
 */
export class EditorViewStore implements Snapshottable<EditorViewSnapshot> {
  readonly modelRootPath: string;

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

  // ---------------------------------------------------------------------------
  // Snapshottable
  // ---------------------------------------------------------------------------

  get snapshot(): EditorViewSnapshot {
    return {
      expandedPaths: [...this.expandedPaths],
    };
  }

  restoreSnapshot(snapshot: Partial<EditorViewSnapshot>): void {
    if (snapshot.expandedPaths) {
      this.expandedPaths.replace(snapshot.expandedPaths);
    }
  }

  // ---------------------------------------------------------------------------
  // Model lifecycle — called by the reaction in TaskViewStore
  // ---------------------------------------------------------------------------

  /**
   * Registers Monaco models (disk, git, buffer) for a file path.
   * For image files, returns the loaded data-URL so the caller (TaskViewStore)
   * can update the tab's content field in TabManagerStore.
   */
  async registerModels(filePath: string): Promise<{ imageContent: string } | undefined> {
    const kind = getFileKind(filePath);

    if (kind === 'image') {
      const result = await rpc.fs.readImage(this.projectId, this.workspaceId, filePath);
      return { imageContent: result.success ? (result.data?.dataUrl ?? '') : '' };
    }

    if (kind === 'text' || kind === 'markdown' || kind === 'svg') {
      const language = getMonacoLanguageId(filePath);
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

    return undefined;
  }

  /**
   * Unregisters all Monaco models for a file path and clears its crash-recovery buffer.
   */
  unregisterModels(filePath: string): void {
    const uri = buildMonacoModelPath(this.modelRootPath, filePath);
    modelRegistry.unregisterModel(uri);
    modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
    modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, HEAD_REF));
    void rpc.editorBuffer.clearBuffer(this.projectId, this.workspaceId, filePath);
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async saveFile(filePath: string): Promise<void> {
    const uri = buildMonacoModelPath(this.modelRootPath, filePath);
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
        log.error('[EditorViewStore] Failed to save file:', filePath);
      }
    } catch (error) {
      log.error('[EditorViewStore] Error saving file:', error);
    } finally {
      runInAction(() => {
        this.isSaving = false;
      });
    }
  }

  async saveAllFiles(openPaths: string[]): Promise<void> {
    const dirtyPaths = openPaths.filter((path) =>
      modelRegistry.isDirty(buildMonacoModelPath(this.modelRootPath, path))
    );
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
    runInAction(() => {
      this.pendingConflictUri = null;
    });

    if (accept) {
      modelRegistry.reloadFromDisk(uri);
      const filePath = uri.replace(`file://${this.modelRootPath}/`, '');
      void rpc.editorBuffer.clearBuffer(this.projectId, this.workspaceId, filePath);
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
   * Restores crash-recovery buffer content for any open tabs whose models are
   * already registered. Called by EditorProvider on mount.
   * Model registration itself is handled by the reactive lifecycle in TaskViewStore.
   */
  async restoreBuffers(): Promise<void> {
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
    // Model unregistration is handled by the TaskViewStore reaction on dispose.
  }
}
